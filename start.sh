#!/bin/bash
cd /root/mission-control
export $(grep -v '^#' .env | xargs)
exec node server.js
