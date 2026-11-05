#!/bin/sh
# Creates a self-signed development certificate for localhost and this machine's
# IPv4 addresses. Reuses the existing one unless it is expiring or an address changed.
set -eu

dir=$1
cert="$dir/cert.pem"
key="$dir/key.pem"

ips=""
for ip in $(hostname -I 2>/dev/null); do
  case "$ip" in *:*) ;; *) ips="$ips $ip" ;; esac
done

valid() {
  [ -f "$cert" ] && [ -f "$key" ] || return 1
  openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null || return 1
  for ip in $ips; do
    openssl x509 -in "$cert" -noout -checkip "$ip" | grep -q "does match" || return 1
  done
}

valid && exit 0

san="DNS:localhost,IP:127.0.0.1"
for ip in $ips; do san="$san,IP:$ip"; done

umask 077
mkdir -p "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
  -keyout "$key" -out "$cert" -subj "/CN=Mawiid development" \
  -addext "subjectAltName=$san" 2>/dev/null
echo "Created a development certificate for $san"
