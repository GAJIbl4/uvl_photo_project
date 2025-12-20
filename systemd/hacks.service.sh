#!/usr/bin/env bash

cd "$(dirname "$BASH_SOURCE")/.."

set -a && source .env && set +a

#sudo ifdown wlan0
#sudo ifup wlan0

#sudo systemctl restart hostapd

sudo nmcli con delete DRONE-AP
sudo nmcli con add type wifi ifname wlan0 mode ap con-name DRONE-AP ssid "DRONE_$DRONE_ID" autoconnect false
sudo nmcli con modify DRONE-AP wifi.band bg
sudo nmcli con modify DRONE-AP wifi.channel 3
sudo nmcli con modify DRONE-AP wifi-sec.key-mgmt wpa-psk
sudo nmcli con modify DRONE-AP wifi-sec.proto rsn
sudo nmcli con modify DRONE-AP wifi-sec.group ccmp
sudo nmcli con modify DRONE-AP wifi-sec.pairwise ccmp
sudo nmcli con modify DRONE-AP wifi-sec.psk UVL123456
sudo nmcli con modify DRONE-AP ipv4.method shared ipv4.address 192.168.0.1/16
sudo nmcli con modify DRONE-AP ipv6.method disabled
sudo nmcli con up DRONE-AP


sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
sudo iptables -t nat -I OUTPUT -p tcp -d 127.0.0.1 --dport 80 -j REDIRECT --to-ports 8080

while true; do sync; sleep 0.1; done
