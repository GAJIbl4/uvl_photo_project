#!/usr/bin/env bash

grep -rho 'process.env\.[A-Za-z0-9\$_]\+' . --exclude-dir=node_modules "$@" | sed 's/process.env.//g' | sort | uniq