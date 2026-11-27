# Mawiid DGX caption runbook kit

Companion files for `output/pdf/mawiid-dgx-caption-runbook-v2.pdf`. Copy them instead of retyping commands from the PDF.

| File | Goes to | Used in |
|---|---|---|
| `patches/p1-stt-executor-threads.diff` | repository, through the team's normal review | Phase 2 |
| `patches/p2-voxtral-engine.diff` | repository, through the team's normal review | Phase 2 |
| `preflight.sh` | DGX `/workspace/mawiid-run/` | every worker start (called by `run-worker.sh`) |
| `run-worker.sh` | DGX `/workspace/mawiid-run/` | Phases 6, 7, 8, 10 |
| `run-voxtral.sh` | DGX `/workspace/mawiid-run/` | Phase 4 (adopt in a window), Phase 10 |
| `voxtral-sampler.sh` | DGX `/workspace/mawiid-run/` | Phase 8 |
| `gpu-workers.py` | DGX `/workspace/mawiid-run/` | any time: workers per GPU, from the running process or an env file |
| `tunnel.sh` | DGX `/workspace/mawiid-run/` | Phase 9 |
| `env/*.env.example` | DGX `/workspace/mawiid-run/env/` (drop `.example`, `chmod 600`) | Phases 5–10 |
| `env/voxtral.conf.example` | DGX `/workspace/mawiid-run/env/voxtral.conf` | Phase 4 |
| `env/tunnel.conf.example` | DGX `/workspace/mawiid-run/env/tunnel.conf` | Phase 9 |
| `vm/docker-compose.dgx.yml` | VM `~/mawiid/infra/compose/` | Phase 9 |
| `vm/authorized_keys.template` | VM `~mawiid-tunnel/.ssh/authorized_keys` | Phase 9 |
| `vm/sshd-mawiid-tunnel.conf` | VM: append to the end of `/etc/ssh/sshd_config` | Phase 9 |

The patches:

- **P1** makes the speech-to-text executor size configurable (`MAWIID_STT_EXECUTOR_THREADS`, default 8, so behaviour is unchanged).
- **P2** ports only the Voxtral work from `origin/graphana_promotheus` into `main`: 13 files under `services/ai`. Merging that whole branch would bring in 294 files, most of them test-report logs. P2 applies cleanly to `main`, P1 and P2 stack, and the STT, pipeline and Voxtral tests pass with both applied. Credit the branch authors in the commit message.

Copy the scripts to the DGX from the repository root:

```sh
scp -r output/dgx-runbook-kit/{preflight.sh,run-worker.sh,run-voxtral.sh,voxtral-sampler.sh,tunnel.sh,gpu-workers.py,env} <dgx-ssh-target>:/workspace/mawiid-run/
```

The env files hold secrets once filled in. Keep them on the DGX only, `chmod 600`, and never commit them.
