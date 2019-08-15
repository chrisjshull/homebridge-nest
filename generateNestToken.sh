#!/bin/bash

read -p "Email: " email
read -p "Password: " password
read -p "Do you have 2FA enabled? (y/n) " fa

if test "$fa" = "y"
then
token=$(curl -s -X "POST" "https://home.nest.com/session" \
-H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
-H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' \
--data-urlencode "email=$email" \
--data-urlencode "password=$password" | python3 -c "import sys, json; print(json.load(sys.stdin)['2fa_token'])")
read -p "2FA code received via SMS: " facode
fatoken=$(curl -s -X "POST" "https://home.nest.com/api/0.1/2fa/verify_pin" \
-H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
-H 'Content-Type: application/json; charset=utf-8' \
-d $'{"pin": "'"$facode"'","2fa_token": "'"$token"'"}' | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
echo "Your nest token is: "
echo $fatoken
else
token=$(curl -s -X "POST" "https://home.nest.com/session" \
-H 'User-Agent: iPhone iPhone OS 11.0 Dropcam/5.14.0 com.nestlabs.jasper.release Darwin' \
-H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' \
--data-urlencode "email=$email" \
--data-urlencode "password=$password" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
echo "Your nest token is: "
echo $token
fi


