# Read AWS through the aws CLI

awol makes every AWS call by running the `aws` CLI as a subprocess (for example `aws rds describe-db-instances --region eu-west-1 --output json`) instead of using the AWS SDK. Credentials, profiles and SSO stay entirely with the CLI the user already has configured, and awol carries no AWS dependency of its own. The cost is one process start per call, well over a hundred per Scan across every enabled region, which awol runs in parallel.

## Considered Options

- **AWS SDK for JavaScript with the default credential chain**: faster and with fewer moving parts per call, but it adds a dependency and a second implementation of credential and SSO handling that can drift from the user's CLI setup.
- **Credentials from `aws configure export-credentials`, calls through the SDK**: keeps the CLI as the credential source, but still needs the SDK and has to handle credential expiry mid-Scan itself.
