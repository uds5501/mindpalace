---
layout: post
title: "Krafty Raft: Deciphering KRaft consensus — 1"
date: 2024-02-18
tags: distributed-systems kafka raft consensus-algorithms
---

My attempt to decipher the Raft whitepaper and how KRaft implementation adheres to the raft philosophy and techniques.

# Introduction

**This could be yet another run-of-the-mill post about the** **[raft consensus algorithm](https://raft.github.io/raft.pdf "@embed")** , possibly one of the least intimidating consensus algorithms that a system engineer might encounter in their career. My aim in this post is to highlight a couple of elements, apart from being a scribble note:
- How KRaft is different from pure Raft.
- Giving insights referring to implementation samples wherever possible to highlight the said difference.

# Moving away from zookeeper

Before we dive down into the Kraft algorithm itself, it’ll be good to understand the history of the alternative it’s replacing. Summarizing [Confluent’s blog on Zookeeper replacement](https://www.confluent.io/blog/why-replace-zookeeper-with-kafka-raft-the-log-of-all-logs/), one could conclude the following about Kafka&#x27;s old architecture

There used to be a single controller broker among other brokers whose primary differentiator among other brokers was storing **cluster metadata like broker IDs and racks, topic, partition, leader and ISR information, and cluster-wide and per topic configs, as well as security credentials.** Zookeeper’s majority of read/write traffic was directed via this controller node.
![Medium-Image](https://miro.medium.com/v2/resize:fit:640/format:webp/1*R_RVQWJa6rPE0arv44T8JQ.png)

The limitations of this setup were in terms of the controller’s scalability. Being a single node, it’s responsible for updating the broker’s metadata linearly per partition.
- The majority of metadata change propagation between controller &lt;&gt; brokers was linear and was done in order of number of partitions, this proved to be a major bottleneck in scaling.
- The maximum number of watchers, size limits on Znodes, etc proved to be a limitation regarding keeping Zookeeper as a metadata store.

## Enter Raft

The fun part behind metadata storage in Zookeeper is that internally, it also stores a sequence of metadata update events, which you can imagine to be a *metadata log*  (to support watchers). So, why not store it as log storage across nodes where the state could be eventually consistent (aka, how raft does it!)
![Medium-Image](https://miro.medium.com/v2/resize:fit:640/format:webp/1*xL0WdQ6cHVPqG-yO_XJP2g.png)

# Participating entities in KRaft and Raft

As per KIP-595’s illustrated [state machine](https://cwiki.apache.org/confluence/display/KAFKA/KIP-595%3A+A+Raft+Protocol+for+the+Metadata+Quorum#KIP595:ARaftProtocolfortheMetadataQuorum-StateMachine), there is one more state a broker could go to apart from the classic **Follower** , **Candidate** , and **Leader**  states called the **Observer**  state.
![Medium-Image](https://miro.medium.com/v2/resize:fit:640/format:webp/1*l8H3HVXj3Fhsn6CO5A-JXQ.png)

As per the above-mentioned KIP, each broker will act as an Observer and every controller node shall act as a Follower / Leader.

I would have loved to go deeper into the metadata quorum data storage, but the [KIP-631](https://cwiki.apache.org/confluence/display/KAFKA/KIP-631%3A+The+Quorum-based+Kafka+Controller) specifying the same hasn’t been accepted yet :(

# Leader election

Let’s move on the the juicy bits, I was interested in how the leader elections take place, and being honest, there’s not a lot of difference between the two flavors of raft in this regard apart from the following distinctions:
- A slice of time where a leader should serve is called **Epoch**  in KRaft whereas its counterpart in “pure” Raft is called **Term** .
- In Kraft, a broker is allowed to vote for only a single broker in an epoch and this state is required even when the broker restarts, hence it’s stored in the disk in a `quorum-state`  file that is fsync’d immediately when appended. You can find the Quorum State structure [here](https://cwiki.apache.org/confluence/display/KAFKA/KIP-595%3A+A+Raft+Protocol+for+the+Metadata+Quorum#KIP595:ARaftProtocolfortheMetadataQuorum-QuorumState).

## Election Begins!

An important distinctive factor in Kraft and Raft is that the former is *pull-based*  while the latter is *push-based* which means that in Kraft, a voter(follower) keeps polling with the leader to find out the latest log entries (we’ll discuss this later in detail).

Keeping this in mind, **an election could be triggered in the following conditions** :
- If it fails to receive a valid `FetchResponse`  from the current leader before the expiration of `quorum.fetch.timeout.ms`
- If it receives a `EndQuorumEpoch`  request from the current leader notifying the end of the Leader’s current term (explained better in the zombie leader section)
- If it fails to receive a majority of votes before the expiration of `quorum.election.timeout.ms`  after declaring itself a candidate.

## The voting process

Let’s say a controller node had to trigger the election due to one of the above-mentioned reasons, in their local persisted quorum state they’d increment the ongoing epoch and ask the peers to vote for them.

In the [raft paper](https://raft.github.io/raft.pdf), section 5.4.1 (Election Restriction) illustrates the conditions for a peer to vote for a broker:
- A voter decides if its term is &lt; the requester’s term or not.
- It also verifies if the logs of the requester are at least up-to-date with its logs or not (it does so by comparing the last term and offsets).

The Kraft implementation uses the same process to determine this apart from verifying if the broker’s candidateId was even expected to be a candidate or not. You can dive deep into code implementation in the [handleVoteRequest()](https://github.com/apache/kafka/blob/e247bd03afe66d61426a9029220d06438dede3dc/raft/src/main/java/org/apache/kafka/raft/KafkaRaftClient.java#L548C30-L548C47) method.

## Handling voting deadlock

Let’s say there was no clear majority through the election process, then there could be two scenarios:
- **This was the first election,**  in that event, the candidate steps down and waits for *quorum.election.backoff.max.ms* before retrying.
- **This election took place when the leader stepped down** , there’s a list of suggested future leaders as per their log’s offset. Here, for each candidate in a descending order, the backoff is configured as `MIN(retryBackOffMaxMs, retryBackoffMs * 2^(N - 1))`  where **N** is the position in the list.

## Announcing the election win and stepping down

Once the leader is elected, it is supposed to send out a **BeginEpochQuorum** **** message where every voter will verify the epoch for which the leader is claiming to win the election, recheck its own cached leader &amp; transition to the follower.

Once the quorum&#x27;s epoch time is finished, the leader transitions to a **RESIGNED**  state and sends all the peers [EndQuorumEpoch](https://cwiki.apache.org/confluence/display/KAFKA/KIP-595%3A+A+Raft+Protocol+for+the+Metadata+Quorum#KIP595:ARaftProtocolfortheMetadataQuorum-EndQuorumEpoch) along with preferred candidates for the next leader election (as mentioned above).

You can check more about the resignation mechanism in [pollResigned()](https://github.com/apache/kafka/blob/e247bd03afe66d61426a9029220d06438dede3dc/raft/src/main/java/org/apache/kafka/raft/KafkaRaftClient.java#L1970) and how the followers have been handling this event in [handleEndQuorumEpochRequest()](https://github.com/apache/kafka/blob/e247bd03afe66d61426a9029220d06438dede3dc/raft/src/main/java/org/apache/kafka/raft/KafkaRaftClient.java#L782).

## Preventing zombie leaders

Suppose a leader is elected during the epoch, the followers will keep asking for data till the end of the quorum epoch. However, once the epoch ends, and for some reason, **the leader fails to resign (it might be offline)** , the candidates by themselves will start a new election. Here the leader might not get the voting event altogether and when it restarts, it might still have the persistent state of being a leader. A famous case of a **zombie leader** .
![Medium-Image](https://miro.medium.com/v2/resize:fit:640/format:webp/1*909pdtnUWB_qCjNxbscdqg.png)

To handle this, if no other voter is coming up to fetch the metadata for `quorum.fetch.timeout.ms`  the leader will start a new election.

If you notice the illustration above, let’s say **A**  was the leader in Epoch 1 but crashed, in the meantime the other followers decided to hold the election and elected **B**  as a new leader. By epoch 3, **A**  restarts and expects itself to be a leader (due to the persistent state). After the configured time passes it will try re-electing itself in epoch 2 but since the current epoch is 3, it’ll become a follower.

**Caveat** : Ideally, if a new leader is already present for the new election, this zombie leader should become a follower but if the zombie stays offline and joins later on while contacting the new candidates during the election, It might end up winning the elections given it achieves the rare condition of
- Having a higher epoch than the rest of the peers.
- Having most up-to-date log end offset (and somehow there’s an peer which has also up-to-date offset which didn’t win the election)

# Appending logs

## Pulling vs Pushing

In the raft literature, it’s a paradigm that the leader should be pushing its logs using “appendRPC” to its followers where the followers will acknowledge the same and append it to their logs.

In KRaft, however, the onus is on the followers and observers to keep fetching the updates and recent logs by themselves using [Fetch API](https://cwiki.apache.org/confluence/display/KAFKA/KIP-595%3A+A+Raft+Protocol+for+the+Metadata+Quorum#KIP595:ARaftProtocolfortheMetadataQuorum-Fetch).

This aids in removing the scalability issue where a single controller node had to propagate the metadata updates to each broker by itself in worst case complexity of `O(partitions)`

## High watermarks and Log End Offset

Before we dive deeper into log appends, we should address a couple of important terms in Kraft’s replication literature.

**High Watermark (HWM) —** This is the highest log offset of a partition that has been replicated across a majority of the In Sync Replicas (ISR).

**Log End Offset (LEO) —** This is the highest log offset of a partition that has been appended on the local leader. This offset might not be replicated across the ISRs. Generally, a leader would move the high watermark only when a majority of the followers have replicated the message hence`(HWM &lt;= LEO)`

## What happens when Followers/Observers invoke FetchAPI?

One of the three things could’ve happened when followers invoke fetch API with their current LEO and term (implementation is elaborated in [HandleFetchRequest()](https://github.com/apache/kafka/blob/e247bd03afe66d61426a9029220d06438dede3dc/raft/src/main/java/org/apache/kafka/raft/KafkaRaftClient.java#L940) method)
![Medium-Image](https://miro.medium.com/v2/resize:fit:640/format:webp/1*IsY7DfuQ62Z6rzIFE2JByQ.png)
- **If the follower’s fetched log offset is currently 0** , just return them the latest offset.
- **If the follower’s fetched offset &gt;log fetch offset**  in leader or simply the epochs don’t match, then it’s a divergent case.
- **All good** ? Then it’s a valid case and update the log end offset for this follower. After this, if high watermark can be updated (implemented in [maybeUpdateHighWatermark()](https://github.com/apache/kafka/blob/e247bd03afe66d61426a9029220d06438dede3dc/raft/src/main/java/org/apache/kafka/raft/LeaderState.java#L210) ). The overall idea is to check the log end offsets of peers in descending order, find the offset of **n/2th**  peer and if the high water mark of said peer is &lt; replicated offset, then update the same)

# Conclusion

By this illustration, I hope I was able to draw a decent comparison between subtle differences among KRaft and Raft. I hope to elaborate more on the Snapshotting semantics in the next blog post (Elaborated in [KIP-630](https://cwiki.apache.org/confluence/display/KAFKA/KIP-630%3A+Kafka+Raft+Snapshot#KIP630:KafkaRaftSnapshot-RejectedAlternatives)). Until next time, peace!
