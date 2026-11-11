#!/usr/bin/env bash
# Production on an Azure GPU VM: `make azure` from the repository root.
#
# Everything `make mawiid` does, plus what the AI worker needs to run MADLAD 10b on the GPU:
#   1. the NVIDIA driver, picked from the VM size (Azure Instance Metadata):
#      NV-series (NVadsA10 v5, NVv3): Microsoft's GRID driver, the only one these GPUs accept;
#      NC/ND-series (T4, A100, H100): Ubuntu's signed data-center driver;
#   2. one reboot when the driver needs it (asked, or REBOOT=1), then `make azure` again;
#   3. checks that the disk and RAM can hold the 10b conversion;
#   4. `make mawiid` with the GPU forced on and MADLAD 10b, then checks that the worker sees the GPU.
# Safe to run again: it is also the update command after a git pull.
#
# Settings (environment or make variables): APP_DOMAIN, RTC_DOMAIN (as make mawiid),
#   MT_MODEL=10b|3b (default 10b), REBOOT=1 (reboot without asking when the driver needs it).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MT_MODEL=${MT_MODEL:-10b}
# Microsoft's GRID driver for NV-series VMs (docs: "Install NVIDIA GPU drivers on N-series VMs running Linux").
GRID_URL=${GRID_URL:-https://go.microsoft.com/fwlink/?linkid=874272}

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then SUDO=; else
  command -v sudo >/dev/null || die "Run as root, or install sudo."
  SUDO=sudo
fi

. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "make azure supports Ubuntu (22.04 or 24.04) Azure images; this is '${ID:-?}'."

# ---------------------------------------------------------------- the VM

step "Azure VM"
vm_size=$(curl -fsS --max-time 3 -H Metadata:true \
  "http://169.254.169.254/metadata/instance/compute/vmSize?api-version=2021-02-01&format=text" 2>/dev/null || true)
if [ -n "$vm_size" ]; then echo "VM size  $vm_size"; else warn "Not on Azure (no instance metadata): continuing with the generic NVIDIA driver."; fi

case "$vm_size" in
  Standard_NV*_v4 | Standard_NG*)
    die "$vm_size has an AMD GPU, which the AI worker cannot use (it needs CUDA). Resize to Standard_NV36ads_A10_v5 or an NC-series size." ;;
  Standard_NV*) driver=grid ;;
  *) driver=cuda ;;
esac

grep -qs 0x10de /sys/bus/pci/devices/*/vendor ||
  die "This VM has no NVIDIA GPU${vm_size:+ ($vm_size)}. Resize it to Standard_NV36ads_A10_v5 (or NC4as_T4_v3, NC A100 v4), then rerun make azure."

reboot_needed() {
  echo
  warn "$1"
  if [ "${REBOOT:-}" = 1 ] || { [ -t 0 ] && read -rp "Reboot now? [Y/n] " answer && [ "${answer:-y}" != n ] && [ "${answer:-y}" != N ]; }; then
    echo "Rebooting. Reconnect in a minute and run make azure again."
    $SUDO reboot
  fi
  echo "Reboot (sudo reboot), then run make azure again."
  exit 0
}

# ---------------------------------------------------------------- NVIDIA driver

step "NVIDIA driver ($driver)"
if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  echo "Installed: $(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader)"
elif [ "$driver" = grid ]; then
  # The GRID installer builds an unsigned kernel module: Secure Boot (Trusted Launch) rejects it.
  $SUDO apt-get update -q
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -q build-essential dkms "linux-headers-$(uname -r)" mokutil
  if [[ "$(mokutil --sb-state 2>/dev/null || true)" == *enabled* ]]; then
    die "Secure Boot is on, and the GRID driver that NV-series GPUs need cannot load with it.
       In the Azure portal: stop the VM, Configuration > Security type > untick Secure Boot, start it,
       then rerun make azure. (az vm deallocate ... && az vm update ... --enable-secure-boot false && az vm start ...)"
  fi
  if [ ! -f /etc/modprobe.d/nouveau.conf ]; then
    printf 'blacklist nouveau\nblacklist lbm-nouveau\n' | $SUDO tee /etc/modprobe.d/nouveau.conf >/dev/null
    $SUDO update-initramfs -u
  fi
  if grep -q '^nouveau ' /proc/modules; then
    reboot_needed "The open-source nouveau driver is loaded and blocks the NVIDIA one; it is now disabled after a reboot."
  fi
  echo "Downloading and installing the Azure GRID driver (a few minutes)"
  installer=$(mktemp --suffix=.run)
  curl -fsSL -o "$installer" "$GRID_URL"
  $SUDO sh "$installer" --silent --dkms || { rm -f "$installer"; die "The GRID driver install failed: see /var/log/nvidia-installer.log"; }
  rm -f "$installer"
  # Licensing settings Microsoft documents for Azure (the license comes with the VM).
  if [ -f /etc/nvidia/gridd.conf.template ]; then
    $SUDO cp /etc/nvidia/gridd.conf.template /etc/nvidia/gridd.conf
    $SUDO sed -i '/^FeatureType=0/d' /etc/nvidia/gridd.conf
    printf 'IgnoreSP=FALSE\nEnableUI=FALSE\n' | $SUDO tee -a /etc/nvidia/gridd.conf >/dev/null
  fi
  reboot_needed "The GRID driver is installed; it starts after a reboot."
else
  # Prebuilt modules signed by Canonical: they load with Secure Boot on.
  $SUDO apt-get update -q
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -q ubuntu-drivers-common
  $SUDO ubuntu-drivers install --gpgpu
  version=$(dpkg-query -W -f='${Package}\n' 'nvidia-headless-no-dkms-*-server' 2>/dev/null | grep -o '[0-9]\+' | sort -n | tail -n1 || true)
  [ -n "$version" ] && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -q "nvidia-utils-$version-server"
  if nvidia-smi >/dev/null 2>&1; then
    echo "Installed: $(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader)"
  else
    reboot_needed "The NVIDIA driver${version:+ $version} is installed; it starts after a reboot."
  fi
fi

# ---------------------------------------------------------------- capacity

step "Disk and memory for MADLAD $MT_MODEL"
if [ "$MT_MODEL" = 10b ]; then need_disk=80; need_ram=26; else need_disk=35; need_ram=12; fi
# Docker keeps images and volumes (Hugging Face download, converted model) under /var/lib/docker.
docker_dir=/var/lib/docker; [ -d "$docker_dir" ] || docker_dir=/var/lib
free_disk=$(df -BG --output=avail "$docker_dir" | tail -n1 | tr -dc 0-9)
# Already converted (a rerun): the volume holds the model and the big download is gone.
converted=0
volume=$($SUDO docker volume ls -q 2>/dev/null | grep -m1 '_ai_models$' || true)
if [ -n "$volume" ]; then
  mountpoint=$($SUDO docker volume inspect -f '{{.Mountpoint}}' "$volume")
  $SUDO test -f "$mountpoint/madlad400-$MT_MODEL-mt-ct2/model.bin" && converted=1
fi
ram=$(awk '/MemTotal/ {printf "%d", $2 / 1024 / 1024}' /proc/meminfo)
echo "Free disk ${free_disk} GB (need ~${need_disk}), RAM ${ram} GB (need ~${need_ram} for the conversion)"
if [ "$converted" = 1 ]; then
  echo "MADLAD $MT_MODEL is already converted."
elif [ "$free_disk" -lt "$need_disk" ]; then
  die "Not enough disk: the $MT_MODEL download and conversion need ~${need_disk} GB free under $docker_dir.
       Azure OS disks start at 30 GB: stop the VM, raise the OS disk size (Disks > OS disk > Size, e.g. 128 GB),
       start it (Ubuntu grows the partition at boot), then rerun make azure."
fi
[ "$converted" = 1 ] || [ "$ram" -ge "$need_ram" ] ||
  warn "Only ${ram} GB of RAM: converting $MT_MODEL may run out of memory. If it fails, use a larger VM once for the conversion, or MT_MODEL=3b."

# ---------------------------------------------------------------- deploy

step "Deploying Mawiid with the GPU and MADLAD $MT_MODEL"
APP_DOMAIN="${APP_DOMAIN:-}" RTC_DOMAIN="${RTC_DOMAIN:-}" AI=1 GPU=1 MT_MODEL="$MT_MODEL" bash "$ROOT/infra/deploy/mawiid.sh"

step "Checking that the AI worker uses the GPU"
cd "$ROOT/infra/compose"
if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=($SUDO docker); fi
compose() { "${DOCKER[@]}" compose --env-file .env.production -f docker-compose.yml -f docker-compose.gpu.yml --profile ai "$@"; }
gpus=$(compose exec -T ai python -c "import ctranslate2; print(ctranslate2.get_cuda_device_count())" 2>/dev/null || echo 0)
if [ "$gpus" -ge 1 ] 2>/dev/null; then
  echo "The AI worker sees $gpus GPU(s)."
  for i in $(seq 1 60); do
    line=$(compose logs ai 2>/dev/null | grep -o 'loading madlad .*' | tail -n1 || true)
    [ -n "$line" ] && { echo "Worker: $line"; break; }
    sleep 5
  done
  [ -n "${line:-}" ] || warn "The worker has not loaded MADLAD yet: follow it with make mawiid-logs S=ai"
else
  warn "The AI worker sees no GPU, so it runs on the CPU (slow with $MT_MODEL). Check: nvidia-smi, then make mawiid-logs S=ai"
fi
