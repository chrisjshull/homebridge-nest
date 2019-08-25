#!/bin/bash

function jsonValue() {
  KEY=$1
  num=$2
  awk -F"[,:}]" '{for(i=1;i<=NF;i++){if($i~/'$KEY'\042/){print $(i+1)}}}' | tr -d '"' | sed -n ${num}p
}

read -p "Email: " email
read -p "Password: " password
read -p "Do you have 2FA enabled? (y/n) " fa

if test "$fa" = "y"
then
token=$(curl -s -X "POST" "https://home.nest.com/session" \
-H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
-H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' \
--data-urlencode "email=$email" \
--data-urlencode "password=$password" | jsonValue 2fa_token 1)
read -p "2FA code received via SMS: " facode
fatoken=$(curl -s -X "POST" "https://home.nest.com/api/0.1/2fa/verify_pin" \
-H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
-H 'Content-Type: application/json; charset=utf-8' \
-d $'{"pin": "'"$facode"'","2fa_token": "'"$token"'"}' | jsonValue access_token 1)
echo "Your Nest access_token is: "
echo $fatoken
else
token=$(curl -s -X "POST" "https://home.nest.com/session" \
-H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
-H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' \
--data-urlencode "email=$email" \
--data-urlencode "password=$password" | jsonValue access_token 1)
echo "Your Nest access_token is: "
echo $token
fi
