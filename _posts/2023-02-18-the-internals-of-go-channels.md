---
layout: post
title: "The Internals of Go Channels"
date: 2023-02-18
tags: go channels 
---

Recently I have been reading about the design of the Go language and this post is an accumulation of notes specific to the buffered channels and how they work.

If you want to understand what a channel in go is, please refer to [this article [1]](https://gobyexample.com/channels). After this point, I assume that we have a basic understanding of a go channel, that being said, let’s now dive in!

Making a go channel
===================

Before we dive into how go channels are made, let’s see **what they look like under the hood.**

Sneak peek at the “hchan” struct
--------------------------------

![captionless image](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*l6ovT9IBB8K8f6y5rE9-RA.png)

The above snippet is from `go/src/runtime/chan.go` , the file which contains the implementation of go channels. The `hchan` struct is the one which stores all the information about a particular channel.

`hchan` has an element `buf` that stores data as a circular queue. `sendx` is the index in which goroutines will push the next element while `recvx` is the index from where the next element will be taken from.

An important thing to note here is that the `lock` not only protects the fields in `hchan`but also protects the fields of the goroutines (`sudog`) blocked in the channels.

Now that we understand the basic structure of a channel, let’s take a look at **how they are initialized.**

The makechan function
---------------------

```go
// go/src/runtime/chan.go
func makechan(t *chantype, size int) *hchan {
   elem := t.elem
   // compiler checks this but be safe.
   if elem.size >= 1<<16 {
      throw("makechan: invalid channel element type")
   }
   if hchanSize%maxAlign != 0 || elem.align > maxAlign {
      throw("makechan: bad alignment")
   }
   mem, overflow := math.MulUintptr(elem.size, uintptr(size))
   if overflow || mem > maxAlloc-hchanSize || size < 0 {
      panic(plainError("makechan: size out of range"))
   }
   // Hchan does not contain pointers interesting for GC when elements stored in buf do not contain pointers.
   // buf points into the same allocation, elemtype is persistent.
   // SudoG's are referenced from their owning thread so they can't be collected.
   // TODO(dvyukov,rlh): Rethink when collector can move allocated objects.
   var c *hchan
   switch {
   case mem == 0:
      // Queue or element size is zero.
      c = (*hchan)(mallocgc(hchanSize, nil, true))
      // Race detector uses this location for synchronization.
      c.buf = c.raceaddr()
   case elem.ptrdata == 0:
      // Elements do not contain pointers.
      // Allocate hchan and buf in one call.
      c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
      c.buf = add(unsafe.Pointer(c), hchanSize)
   default:
      // Elements contain pointers.
      c = new(hchan)
      c.buf = mallocgc(mem, elem, true)
   }
   c.elemsize = uint16(elem.size)
   c.elemtype = elem
   c.dataqsiz = uint(size)
   lockInit(&c.lock, lockRankHchan)
   if debugChan {
      print("makechan: chan=", c, "; elemsize=", elem.size, "; dataqsiz=", size, "\n")
   }
   return c
}
```

Here, `makechan`function initializes a `hchan` struct calculates the size of the buffer needed according to the element being stored, and eventually returns a pointer to the struct (`*hchan`).

> I’ll be honest here, I am not very sure what the bad alignment validation is all about, diving a little deeper shows that it’s about memory validation and type alignment in go, couple of topics which I am not very sure about. Probably next blog post will be about that? _😄_

Sending an element to the channel
=================================

Now, let’s talk about how a goroutine (_g1_) pushes an element in the channel.

Channel sends are handled by `chansend`

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
  if c == nil {
    if !block {
     return false
    }
    gopark(nil, nil, waitReasonChanSendNilChan, traceEvGoStop, 2)
    throw("unreachable")
   }
  
   if debugChan {
    print("chansend: chan=", c, "\n")
   }
  
   if raceenabled {
    racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
   }
  
   // Fast path: check for failed non-blocking operation without acquiring the lock.
   //
   // After observing that the channel is not closed, we observe that the channel is
   // not ready for sending. Each of these observations is a single word-sized read
   // (first c.closed and second full()).
   // Because a closed channel cannot transition from 'ready for sending' to
   // 'not ready for sending', even if the channel is closed between the two observations,
   // they imply a moment between the two when the channel was both not yet closed
   // and not ready for sending. We behave as if we observed the channel at that moment,
   // and report that the send cannot proceed.
   //
   // It is okay if the reads are reordered here: if we observe that the channel is not
   // ready for sending and then observe that it is not closed, that implies that the
   // channel wasn't closed during the first observation. However, nothing here
   // guarantees forward progress. We rely on the side effects of lock release in
   // chanrecv() and closechan() to update this thread's view of c.closed and full().
   if !block && c.closed == 0 && full(c) {
    return false
   }
  ...
}
```

If the `send` on the channel is not blocking and the channel is full, it just returns a `false` or, if the channel is closed, it’ll throw an error saying `send on closed channel`

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
  ...
  if sg := c.recvq.dequeue(); sg != nil {
     // Found a waiting receiver. We pass the value we want to send
     // directly to the receiver, bypassing the channel buffer (if any).
     send(c, sg, ep, func() { unlock(&c.lock) }, 3)
     return true
  }
  ...
}
```

Otherwise, it will first check whether the channel has any waiting receiver goroutine (_g2_), if yes, _g1_ will directly send data to _g2_’s stack! (It also implies that the channel was already empty, we’ll discuss this direct copy more in detail)

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
  ...
  if c.qcount < c.dataqsiz {
     // Space is available in the channel buffer. Enqueue the element to send.
     qp := chanbuf(c, c.sendx)
     if raceenabled {
        racenotify(c, c.sendx, nil)
     }
     typedmemmove(c.elemtype, qp, ep)
     c.sendx++
     if c.sendx == c.dataqsiz {
        c.sendx = 0
     }
     c.qcount++
     unlock(&c.lock)
     return true
  }
  ...
}
```

Let’s say there was no waiting goroutine(_g2_), then we check whether there is space available in the channel buffer, if it is, we copy the element in buffer memory and increment the `sendx` and `qcount` while unlocking the channel!

![Populating c.buf with memory copy](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*wEFxS_jUg5FeXDpllcyndQ.png)

But… what will happen if there was no space left in the channel’s buffer? Here, two situations can happen.

![How blocking and nonblocking sends are compiled.](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*Q4YVE5bPF9vb5-j0I-OPoA.png)

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
  
  ...
  
  if !block {
     unlock(&c.lock)
     return false
  }
  
  // Block on the channel. Some receiver will complete our operation for us.
  gp := getg()
  mysg := acquireSudog()
  mysg.releasetime = 0
  if t0 != 0 {
     mysg.releasetime = -1
  }
  // No stack splits between assigning elem and enqueuing mysg
  // on gp.waiting where copystack can find it.
  mysg.elem = ep
  mysg.waitlink = nil
  mysg.g = gp
  mysg.isSelect = false
  mysg.c = c
  gp.waiting = mysg
  gp.param = nil
  c.sendq.enqueue(mysg)
  // Signal to anyone trying to shrink our stack that we're about
  // to park on a channel. The window between when this G's status
  // changes and when we set gp.activeStackChans is not safe for
  // stack shrinking.
  gp.parkingOnChan.Store(true)
  gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceEvGoBlockSend, 2)
  // Ensure the value being sent is kept alive until the
  // receiver copies it out. The sudog has a pointer to the
  // stack object, but sudogs aren't considered as roots of the
  // stack tracer.
  KeepAlive(ep)
  
  // someone woke us up.
  if mysg != gp.waiting {
     throw("G waiting list is corrupted")
  }
  gp.waiting = nil
  gp.activeStackChans = false
  closed := !mysg.success
  gp.param = nil
  if mysg.releasetime > 0 {
     blockevent(mysg.releasetime-t0, 2)
  }
  mysg.c = nil
  releaseSudog(mysg)
  if closed {
     if c.closed == 0 {
        throw("chansend: spurious wakeup")
     }
     panic(plainError("send on closed channel"))
  }
  return true
}
```

If it were a non-blocking send call, we’ll move out of the send function, if not, then we enqueue this sender (_g1_) to the channel's `sendq` and ask the go runtime scheduler to pause _g1._

> The **sudog** here is a struct which holds information for a waiting goroutine (in our case, **g1**). Go runtime is going to park this **sending** **goroutine (g1),** and according to comments, we are ensuring that
> 
> 1. g1's stack should not shrink — (understand more about stack growth and shrinking from this [video](https://www.youtube.com/watch?v=-K11rY57K7k)[4])
> 2. Ensure that the value which g1 was going to send is kept alive until receiver (g2) copies out of it.

When a receiver goroutine (_g2_) comes along and wakes us up, we finally release the `sudog` and check if the channel was closed or not once again. If it was, throw an error, else return true!

Now, what was that direct send thing again?
-------------------------------------------

In an empty-buffered / unbuffered channel, when _g2_ is already present in `recvq` , go allows the _g1_ to directly copy the element in receiving _g2’s_ stack.

The Go GC assumes that stack writes only happen when _g1_ is running and is only done by it.

![Screenshot from Kavya’s video regarding the scenario when g2 comes first.](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*l-QhXKEyTfguIZ2vOP893g.png)

A thing to note is that a write barrier is established before the element is copied to the stack of receiving goroutine. This saves one memory copy operation! The actual implementation of `memmove` can be found here — [CPP Reference](https://en.cppreference.com/w/c/string/byte/memmove)[5]

Receiving an element from the channel
=====================================

As the title suggests, here we need to understand how a goroutine receives an element from the channel. following earlier conventions, the receiver goroutine will be _g2,_ and sending goroutine will be _g1._

Receives are handled by `chanrecv` and the docstring has beautifully explained its role, so I am just going to state that here —

> **chanrecv** receives on channel **c** and writes the received data to **ep**.
> **ep** may be nil, in which case received data is ignored.
> If **block** == false and no elements are available, returns (false, false).
> Otherwise, if **c** is closed, zeros ***ep** and returns (true, false).
> Otherwise, fills in ***ep** with an element and returns (true, true).
> A non-nil **ep** must point to the heap or the caller’s stack.

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
  ...
  if c.qcount > 0 {
     // Receive directly from queue
     qp := chanbuf(c, c.recvx)
     if raceenabled {
        racenotify(c, c.recvx, nil)
     }
     if ep != nil {
        typedmemmove(c.elemtype, ep, qp)
     }
     typedmemclr(c.elemtype, qp)
     c.recvx++
     if c.recvx == c.dataqsiz {
        c.recvx = 0
     }
     c.qcount--
     unlock(&c.lock)
     return true, true
  }
  ...
}
```

Pretty standard circular queue operations again, after certain validations and checking if there is no _g1_ already in `sendq` , it checks whether there is any element in the channel or not. If there is an element, the channel copies it to `ep` and `recvx` is incremented while `qcount` is decrement and the channel is unlocked.

![Receiving data from a channel](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*T-y7fMf5rTGsgofn33DPNg.png)

If there was a _g1_ already present in `sendq`, _g2_ will initiate a direct receive to `ep` if the buffer is empty, just like a direct send was done, otherwise, _g2_ will take the element from the head of the buffer and copy the element from _g1_’s stack to the tail of the channel buffer and unpark _g1.(i.e.,_ set _g1_ back to runnable)

```go
// The portion responsible to initiate the 2 phase receive
func recv(c *hchan, sg *sudog, ep unsafe.Pointer, unlockf func(), skip int) {
   if c.dataqsiz == 0 {
      if raceenabled {
         racesync(c, sg)
      }
      if ep != nil {
         // copy data from sender
         recvDirect(c.elemtype, sg, ep)
      }
   } else {
      // Queue is full. Take the item at the
      // head of the queue. Make the sender enqueue
      // its item at the tail of the queue. Since the
      // queue is full, those are both the same slot.
      qp := chanbuf(c, c.recvx)
      if raceenabled {
         racenotify(c, c.recvx, nil)
         racenotify(c, c.recvx, sg)
      }
      // copy data from queue to receiver
      if ep != nil {
         typedmemmove(c.elemtype, ep, qp)
      }
      // copy data from sender to queue
      typedmemmove(c.elemtype, qp, sg.elem)
      c.recvx++
      if c.recvx == c.dataqsiz {
         c.recvx = 0
      }
      c.sendx = c.recvx // c.sendx = (c.sendx+1) % c.dataqsiz
   }
   sg.elem = nil
   gp := sg.g
   unlockf()
   gp.param = unsafe.Pointer(sg)
   sg.success = true
   if sg.releasetime != 0 {
      sg.releasetime = cputicks()
   }
   goready(gp, skip+1)
}
```

**Why?** So that _g1_ does not have to acquire the channel’s lock again and copy the element to buffer itself, hence saving some CPU cycles. Brilliant IMO!


<iframe width="560" height="315" src="https://www.youtube.com/embed/KBZlN0izeiY?si=OQZEBeoLBUZzptjU&amp;start=880" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

Lastly, if there is no element to receive from the channel, the channel will either unlock itself and return true; or park _g2_ and enqueue it `recvq` until a sender (_g1_) comes along and wakes _g2_ up.

Conclusion
==========

Hopefully, with the aid of these notes and accompanying illustrations, I managed to demystify how channels internally work in Go.

I have come to love the small tweaks and optimizations which Go-engineers have done in such a simple data structure to save a few CPU cycles and ensure memory safety like the **_direct sends & receives_**, **_memcpy_** and I hope I illustrated them well enough for you to appreciate them as well :D

Resources
=========

*   [1] Go Channels — [https://gobyexample.com/channels](https://gobyexample.com/channels)
*   [2] GopherCon 2017: Kavya Joshi — [Understanding Channels](https://www.youtube.com/watch?v=KBZlN0izeiY)
*   [3] [Memory Layout in Go](https://go101.org/article/memory-layout.html)
*   [4] [Go scheduler: Implementing language with lightweight concurrency](https://www.youtube.com/watch?v=-K11rY57K7k)
*   [5] [CPP Reference — memmove_.s](https://en.cppreference.com/w/c/string/byte/memmove)
