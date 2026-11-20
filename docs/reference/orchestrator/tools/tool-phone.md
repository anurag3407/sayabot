# Android Mobile Device Control Tool

> Reference guide for `android_device_control`.

## Overview

The `android_device_control` tool provides Sayabot agents with real-time control over physical or virtual Android devices via an ADB / scrcpy bridge in `computerd`.

---

## Operations & Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `action` | `string` | Yes | `list_devices \| get_info \| screenshot \| tap \| swipe \| key \| type_text \| launch_app` |
| `serial` | `string` | No | Target device serial identifier |
| `x`, `y` | `number` | Conditional | Coordinates for `tap` or start of `swipe` |
| `end_x`, `end_y` | `number` | Conditional | Target coordinates for `swipe` |
| `duration_ms` | `number` | No | Swipe duration (default: 300ms) |
| `key` | `string` | Conditional | Android key name (`HOME`, `BACK`, `ENTER`, `APP_SWITCH`, `VOLUME_UP`, etc.) |
| `text` | `string` | Conditional | String to type into active input field |
| `package_name` | `string` | Conditional | Package name to launch (e.g. `com.android.chrome`) |

---

## Safety & Approval Model

The `dangerous` property evaluates dynamically:
- **Read-Only Actions (`false`)**:
  - `list_devices`
  - `get_info`
  - `screenshot`
- **Mutating & Interactive Actions (`true`)**:
  - `tap`, `swipe`, `key`, `type_text`, `launch_app` require human operator approval before input injection occurs.
