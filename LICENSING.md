# Licensing

Sayabot is **open core**:

| Part                                                        | License                                               | What it means                                                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything in this repository **except** `ee/` folders      | [AGPL-3.0](LICENSE)                                   | Free to use, self-host, modify and share. If you run a modified Sayabot as a service for others, you must offer them your changes under the same license. |
| `ee/` folders (e.g. [`apps/web/src/ee/`](apps/web/src/ee/)) | [Sayabot Commercial License](apps/web/src/ee/LICENSE) | The paid Sayabot Cloud parts (billing and plans). Readable, but running them in production needs a commercial agreement.                                  |

## Self-hosting

Self-hosting on your own server is free under the AGPL. The `ee/` code is switched off unless
`SAYABOT_EDITION=cloud`, so a self-hosted server never runs it and has no plans, limits or
paywalls. See [docs/self-hosting-quickstart.md](docs/self-hosting-quickstart.md).

## Contributing

Contributions are accepted under the [Contributor License Agreement](CLA.md), which lets the
project keep offering both licenses.

## Earlier versions

Versions published before this file described the project as MIT-licensed. Copies obtained under
that notice keep it; this license applies from the commit that added this file onward.

Questions about commercial licensing: open an issue or contact the maintainer.
