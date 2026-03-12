#!/bin/bash
cd /root/mission-control
export $(grep -v '^#' .env | xargs)
exec node .next/standalone/server.js
