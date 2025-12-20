#!/usr/bin/env bash

cd "$(dirname "$BASH_SOURCE")/.."

if [ ! -z $(grep "^REALSENSEPY_EN=true" ".env") ]
then
  ./realsense.py
else
  echo Realsense disabled in the config file, sleeping indefinitely.
  sleep infinity
fi