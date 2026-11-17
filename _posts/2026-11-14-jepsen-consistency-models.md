---
layout: post
title: "jepsen consistency-models distributed-systems databases"
date: 2026-11-14
tags: jepsen consistency-models notes
---

This adds no value over existing set of consistency models listed by [Jepsen](https://jepsen.io/consistency). This is more of a N2S to remind myself what they are (as I frequently get confused between them). 

![jepsen.png]({{site.baseurl}}/assets/images/posts/2026-11-14-jepsen-consistency-models/jepsen.png)

I'll build from the leaves of the said models. I'll be using $_r$ for read transactions, $_w$ for write transactions.

##  ANSI Phenomenons to remember
Assume at $t=0, x=5$. 
- **Dirty Write (DW)**: If $A_w$ is performing $x=10$, didn't commit yet. At the same time $B_w$ comes in and does a $x=20$ and commits. Now, $A_w$ is aborted, this would set the value of $x=5$ again, even when $B_w$ was committed. This is a **dirty write**.
- **Dirty Read (DR)**: If $A_w$ is performing $x=10$, didn't commit yet. At the same time $B_r$ comes in and reads $x$, it'll see $x=10$. Now, $A_w$ is aborted, this would set the value of $x=5$ again, but $B_r$ has already done work with the uncommitted value. This is a **dirty read**.
- **Fuzzy (non-repeatable) Reads(FR)**: A transaction $A_r$ read $x$ at $t=0$, it got $x=5$, another txn $B_w$ at $t=4$ shows up, does $x=100$, commits. Now at $t=5$, $A_r$ reads $x$ again (same running txn), it will now see $x=100$. This is **fuzzy reads** (assume $A_r$ was read-only and never changed $x$ itself).
- **Phantom Reads (PR)**: Imagine $A_r$ reads 10 rows matching some condition (for ex: cafes open after 10pm). $B_w$ adds one more cafe with $closing_time=11pm$. $A_r$ re-running the same condition will now see 11rows, the one extra row is the **phantom row** :).  

## Read uncommitted
- Can involve multiple objects in the system.
- If $A_w$ completes first then $B_r$ stats, $B_r$ is not guaranteed to observe the writes by $A_w$.
- Any ordering is possible. It can schedule all reads first, then execute your writes.
- No process ordering - A process can execute a write, then fail to read the said write in subsequent txn (wtf?).
- DW - not allowed.
- DR, FR, PR - allowed.
- Can stay totally available in network outage (each node can make progress separately.)

## Read committed
- Everything equal to Read Uncommitted but DRs are not allowed either.

## Monotonic Atomic View
- Tightens read-committed by ensuring that if a $B_*$ runs after $A_*$, it either observes all the affects of $A_*$ or none of it, it's not allowed to pick and choose. 
- Gemini helped with an example here:
  - Assume 2 accounts, $x=\$100$, $y=\$50$, $A_w$ records a transaction of $\$25$ transfer in 2 steps. $t0: x-=25, t1: y += 25, t3: commit$.
  - If $B_r$ needs to get sum of both accounts, it'll read both x & y. This is a logically wrong but legal read-committed $B_r$ reads $x$ at t < t1 ($x=100$) and then reads $y$ at t>t3 ($y=75$) so $x+y=175!$. Free money hack :P 
  - In monotonic atomic view, $B_r$ will either read both effects of $A_w$ or none, either way it'll amount to $x+y=150$ :)
- Other elements are similar to Read committed.

## Cursor Stability
- Improvement on top of read committed, basic idea is if a txn is reading / modifying certain object $x$, it'll hold a cursor to it. Until this cursor is held, another txn $B_*$ can't change these objects.
- Helps prevent lost updates (by subsequent trxns.)

## Snapshot Isolation
- Each trxn ($A_*$) works on the state of database when the it started. If other trxn ($B_*$) starts after former has begun, it won't see any changes that trxn. does.
- $A_w$ can change objects but it won't be shown to other trxns that concurrently began, only the trxns starting after commit time can see the changes.
- If $B_w$ changes the same objects $A_w$ did (assuming $A_w$ committed earlier), $B-w$ will have to abort.
- It won't be totally available (some nodes can't make progress in presense of network partition)
- What the hell is **write skew**? 
  - Technically, 2 transactions making independent decisions by reading a common value at the same point of time and end up changing 2 different values, out of which only one should've been changed
  - Three accounts: $x=12, y=10, z=10$, $A_w$ and $B_w$ both read $x=\$12$, and if $x>10$, they are allowed to award $\$5$ $x$ to $y$ and $z$ respectively. At some time $t$ they both read $x=12$, and end up transferring, making end condition $x=\$2, y=\$15, z=\$15$, violating the if condition.
- Other elements seems similar to read commited.

## Repeatable Read
- Everything else is same as lower levels, just adds the support to shut down fuzzy reads (a txn will read the receive value for an object later in the trxn as well)

## Serializability
- If a db is running multiple concurrent trxns, the final result should look like the individual trxns have been run in some order.
- Gemini gave 2 ideas:
  - 2 phase locking (pessimistic of sorts) - If $A_w$, $B_w$ reads same object, they both share the read lock, however if $A_w$ upgrades with write lock, $B_w$ can't progress and have to wait, forcing an order.
  - Serializable Snapshot Isolation - Both transactions read it, however if $A_w$ commits first, it's found that $B_w$'s work is done on premise that certain condition was true earlier and is not true anymore, and hence it's aborted and retried again.
- Not necessary to support real time ordering.

## Strict Serializability
- Trxns happening in a total ordering and consistent with the real-time ordering of the operations.
- If operation A completes before operation B begins, then A should appear to precede B in the serialization order.
- Multi object.

----

## Writes follow reads
- Called session causalty.
- In a single-node setup, this is handled automatically, the value comes in multi node replicated setups.
- Ex: Replicas (Imagine there are 2 replicas, at $t=$, a user's balance is $x=\$500$ in replica1, and $x=\$0$ in replica 2 (it's lagging behind) and a status for a user could be STANDARD / VIP).
  - Process $A$ sees replica 1, find out $x \ge \$500$ and wants to set the user status to VIP. It reads a **causal token/metadata** : `version={Replica1: {time_stamp/epoch}}`
  - Due to load balancing, it ends up sending the status update to replica 2, the write is $status=VIP$ with the above mentioned token.
  - Now, replica 2 *should not* apply the write until it has replicated the balance (i.e. satisfied the token), otherwise it'd seem that the user has been given VIP status even though the balance is $\$0$!

## Monotonic Reads
- If $B_r$ happens after $A_r$,then $B_r$ should observe all the writes that $A_r$ saw and shouldn't see the state of the objects prior that.
- Applies on the reads happening on the *same process*, not different processes.

## Monotonic Writes
- If a txn does $A_w$ first, then $B_w$, then all the other processes observe the writes in that order.
- Applies on writes by the same process, not diff processes.

## Read your writes
- If a txn does $A_w$, then a subsequent $B_r$ should read the effect of that.
- Applies per process.

## PRAM (Pipeline Random Access Memory)
- To improve concurrency.
- It enforces that any pair of writes executed by a single process are observed (everywhere) in the order the process executed them (basically monotonic write :) 
- Writes from different processes may be observed in different orders.

## Causal Consistency
- Causal consistency can be thought of listing of elements in a _happens before_ sort of relationship.
- Given example of `question: lunch?` and two participants responding `A: yes`, `B: no`. The ordering to questioner and responder could either look like `Q, A, B` or `Q, B, A` but NEVER `[A,B], Q` because `Q` was the reason other 2 exists.
- Imagine it as a DAG, `A -> Q` and `B -> Q` as edges, you can traverse from either A / B  and reach the above ordering.
- Real-time causal consistency eventually make all the participants agree to a single sequence.
- Sticky available!

## Sequential Consistency
- Again, it talks about all the operations appearing to happen in some serial order and the order is consistent with the order of operations in the individual processes.
- Head scratcher - how tf is it different from **Serializability?** (thanks gemini ig)

| Property          | Sequential Consistency                                                                              | Serializability                                                  |
|-------------------|-----------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| Unit of execution | Single operation (a read / write) on a single object                                                | Multiple operations on multiple objects                          |
| Per-process order | Each $A_r$ / $A_w$ operation is enforced to execute in the same order it was listed in the process. | The $A_r$ / $A_w$ operations can be reordered.                   |
| Real-time?        | Process $B$ can lag Process $A$ by arbitary time                                                    | Trxn. $A_*$ starting after $B_*$ can be ordered to start before. |


## Linearizable
- Real time enforced version of sequential consistency. If some operation $B_*$ happens after $A_*$, logically $B_*$ will observe all the affects of $A_*$ and take place after $A_*$.
- Single object model.
