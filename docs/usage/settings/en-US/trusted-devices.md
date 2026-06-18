# Trusted Devices

This page manages devices allowed to sign in to the current account.

## Signed Out

- Login: Opens the login entry. Trusted devices require sign-in.

## Signed In

- Device name: Trusted device name. The current device is marked as current.
- Device info: User Agent, IP, location, and redacted MAC address.
- Remove: Revokes trust for non-current devices. The current device cannot be removed here.
- Count: Shows trusted-device count and limit, such as `1/3`.

After a device is removed, it must pass account verification again on its next login.
