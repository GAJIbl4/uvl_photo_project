#!/usr/bin/env bash

cd "$(dirname "$BASH_SOURCE")/.."

if [  -e "./updates" ] && [ "$( ls -A './updates' )" ]; then
  echo Updates found, updating...
  mv ./updates/* .
fi

if [ -e "./uvl-inventory-offboard" ]; then
  echo Running binary
  ./uvl-inventory-offboard
else
  echo Running from source
  node .
fi
