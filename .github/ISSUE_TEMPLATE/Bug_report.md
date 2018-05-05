---
name: Bug report
about: Create a report to help us improve

---

**Describe the bug**

**To Reproduce**
Steps to reproduce the behavior:
1. 

**Expected behavior**

Include with your bug report this version info:
```sh
node --version
homebridge --version
```

Make sure you have the latest LTS from https://nodejs.org
and the latest packages: `npm upgrade -g homebridge homebridge-nest`

Also include debug log output from startup through seeing the issue:
`DEBUG=* homebridge -D`
