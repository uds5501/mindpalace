---
layout: post
title: "Pushing Redis Sentinels to their limit"
date: 2023-06-23
tags: redis benchmarking
---

Script and tips on how to set up multiple master-replica Redis instances and multiple Redis sentinels to monitor them.

Introduction
============

Before I even introduce this script, allow me to explain why did I even need to write this? Currently, there is **no maximum limit documented on the number of masters a single Redis sentinel can monitor** at the same time (at least I couldn’t find any after hours of scouring through the [Redis Sentinel documentation](https://redis.io/docs/management/sentinel/)[1] and their client spec 😢) and I wanted to test the scalability of these

I turned to our good AI friend, chat GPT for its help, who, very weirdly stated that **“Redis 6.x can monitor up to 10 masters.”**

{% include link-preview.html 
    title="Redis Sentinel: Max Masters"
    description="A conversational AI system that listens, learns, and challenges"
    url="https://chat.openai.com/share/34f8bf31-3bd4-46a9-b596-5851463cb7d1"
    domain="chat.openai.com"
%}

![Chat GPT stating the limit of a maximum of 10 masters](https://miro.medium.com/v2/resize:fit:2000/format:webp/1*jwFwtB0O7tytDWY8VPqxeQ.png)

This was bad news for me because I didn’t want Redis Sentinels to be a point of failure in the scenario I want them to monitor the production level, which is **easily >25** Redis master-replica instances. So I decided to go ahead and do what every good engineer should do, create a small POC and test this claim 😁

Small Experiment 🧪
===================

I created this small script to generate a couple of things :

1.  Docker Compose file which contains the following instances:
    - configurable number of Redis master-replica instances.
    - configurable number of Redis sentinels.
2.  Redis Sentinel configuration files.
    - Creates as many configurations as the number of Redis sentinels.
here?

{% gist df499fb528127beb889eb1236718f585 %}

Steps to use this script
------------------------

```sh
// I am assuming benchmark is your present working directory.
$ cd benchmark 
$ mkdir config/sentinel
$ chmod -R 0777 config/
$ python3 docker-compose-gen.py {number of masters} {number of sentinels}
$ docker compose up --remove-orphans
```

**Why give full access to the “config/” folder?** 🤔
----------------------------------------------------

We did so because corresponding Redis sentinel instances will be creating temporary configs and updating the existing configurations. To ensure that works smoothly, you need to give full permission to this directory before mounting it to the sentinel’s container’s volumes.

Results
=======

I won’t be going deep into what the Redis sentinel’s configurations mean in this blog post, the [tutorial](https://redis.io/docs/management/sentinel/#a-quick-tutorial)[2] in their documentation explains the values well.

Docker resource provisioning
----------------------------

I wanted to simulate a scenario where each sentinel server has 2 vCPUs and 8 GiB memory to work with, but since I have only an M1 and want to scale the setup to **~50 master-replica instances + 3 sentinels**, I decided to provision my [_colima_](https://github.com/abiosoft/colima)[3] with **6 CPU cores and 10 GiB** memory.

![Colima configuration](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*oVpii3DYF8CVhmsJcRqGfA.png)

Verifying if all sentinels are monitoring a master 🕵️‍♂️
---------------------------------------------------------

After creating a configuration with 50 master replicas and 3 Redis sentinels, we can verify if a sentinel process (let’s call it sentinel-1) has registered that other sentinels too are monitoring this master (in this example, it’ll be `mymaster-1` ).

### 1. Verifying via logs

If you notice the logs of your other 2 sentinel processes, you’ll notice a `+sentinel` event against `mymaster-1` .

![Logs of sentinel process](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*vQqxrCOEt0_9sOWqZGZ8Uw.png)

These `+sentinel` events show that the particular redis-sentinel has registered a peer sentinel process `4ef980b...` running on `172.18.0.101:5000` is also monitoring `mymaster-1` which is running on `172.18.0.26:6379` .

### 2. Verifying by checking the configuration file

If you head into `config/sentinel/sentinel-1.conf` , and search for `mymaster-1` , you’ll notice the following

![sentinel-1.conf](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*XGz49ul7y6try7rXoXOtjw.png)

This sentinel process has registered the other 2 sentinel processes and set that with `known-sentinel` .

### 3. Verifying via redis-cli

You could verify the same by running the command `sentinel sentinels mymaster-1` in Redis cli of a sentinel server.

![sentinel sentinels mymaster-1](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*gBT2jtgNgnmGNgQ86D1Pmw.png)

Testing failovers 🔥
====================

To test failovers and see the automatic replica to master upgrade in action, you could do one of the following to any master instance.

1.  Run the following command to put the master instance to sleep for some time:
    `$ redis-cli -p 6379 DEBUG sleep 30`
2.  Or, you could simply kill a docker container:
    `$ docker kill redis-master-10`

![Failover logs of redis-sentinel](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*gGg220AKSIB7ZynY6F8heQ.png)

I killed a docker container and let’s dive deeper into the events of what exactly happened from the sentinel POV.

1.  Each sentinel process emitted a **_+sdown master mymaster-10 172.18.0.9 6379_** event, signifying that they have detected that `mymaster-10` is no longer reachable.
2.  The **_+sdown_** event got escalated to **_+odown_ with quorom of 2/2_,_** means at least 2 sentinels agree that this master is no longer reachable, so a failover can begin now.
3.  An election occurs for determining which sentinel process will perform this failover, in this election, **_redis-sentinel-3 (24911173b3ca868e5eb71cbfbda725d310629e26)_** won (you can verify which sentinel is which by checking `myid` from their config or check for `+elected-leader` being emitted from their logs).

![sentinel elections](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*REYlxtyAguwnJ4izYMluqA.png)

4. This sentinel process performs a failover right away and `redis-slave-10` assumes the master role.

![redis-sentinel-3 performing a failover](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*9IAWIhbtjQMKhjSKDM2b2g.png)

I tried failing over multiple masters at the same time and that went smooth as butter 😮, looks like 10 is definitely not the upper limit of masters which a sentinel group can monitor.

Conclusion ✅
============

We come to the conclusion that a small group of 3 Redis sentinels can easily monitor and perform failover on ~50 master-replica instances with ease if the entire setup is provisioned with 6 CPU cores and 10 GiB memory and don’t trust AI so easily without performing small experiments yourself 😛

Until next time! 👋

Resources 🔗
============

*   [1] [Redis sentinel documentation](https://redis.io/docs/management/sentinel/)
*   [2] [Sentinel official tutorial](https://redis.io/docs/management/sentinel/#a-quick-tutorial)
*   [3] [Github: abisoft/colima](https://github.com/abiosoft/colima)
