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
