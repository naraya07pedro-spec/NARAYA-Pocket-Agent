# Benchmarks | NOT MEASURED

Do not infer RAM, CPU, battery, latency, or throughput from unit-test wall time. No device or Cloudflare runtime benchmark has been performed. Required later: commit SHA, hardware/OS/Android build, dependency versions, sample size, workload, repetitions, raw results, p50/p95/p99 where relevant, idle-vs-active footprint and failure rate.


## P1-B mobile measurement protocol (NOT YET EXECUTED)

**Fixed workload:** install the debug APK on a consenting Android device; create three public repository drafts; record baseline idle memory and process start PSS; press `Check now` on one repository online; refresh once unchanged; enter airplane mode; attempt a refresh and verify previous SHA remains; force stop and reopen offline; inspect last cached SHA.

Record: exact APK SHA-256 and CI run, device model, Android release, advertised and available RAM, sample count (at least five runs for a first baseline), observed network bytes where measurable, `adb shell dumpsys meminfo dev.naraya.pocketagent` PSS while idle and after active check, startup duration, CPU behavior, thermal and battery notes, crashes/ANRs. Use median and tail statistics only after collecting actual raw measurements.

**Engineering bounds, not performance measurements:** read-only HTTP GET, 32 KiB maximum JSON response, 20 draft cap, 6s connect/read socket timeouts, no continuous background work and no local LLM. These limit exposure but DO NOT prove low RAM usage or acceptable battery drain without hardware measurements.
