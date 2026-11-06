# awol

A read-only dashboard that shows how far the AWS components you run have drifted from their supported versions, and which ones have quietly lost support.

## Language

### Inventory

**Component**:
One AWS resource that runs a versioned engine or runtime, such as an RDS instance, an Aurora or Multi-AZ DB cluster, an ElastiCache replication group or Serverless cache, an OpenSearch domain, or a Lambda function and each of its published versions an alias points to.
_Avoid_: Resource, asset, service

**Product**:
A piece of software whose lifecycle endoflife.date tracks, such as RDS PostgreSQL or AWS Lambda.
_Avoid_: Engine, technology, service

**Release Cycle**:
A line of a Product that shares one set of support dates, such as RDS PostgreSQL 13 or Lambda python3.12.
_Avoid_: Version, branch, release line

**AWS major version**:
A line of a Product that AWS publishes its own support dates for, such as RDS PostgreSQL 13 or RDS MySQL 8.0. It can be wider than a Release Cycle: RDS MySQL Release Cycle 8.0.46 sits within AWS major version 8.0.
_Avoid_: Major version, major, engine version

### Setup

**Discovery**:
The setup step that finds which services an AWS account uses, region by region, including services awol cannot monitor yet.
_Avoid_: Onboarding, crawl, inventory

**Monitored service**:
A service the user chose, from what Discovery found, for Scans to read.
_Avoid_: Enabled service, tracked service

**Scan**:
One read of the Components of an AWS account's Monitored services, or of every supported service before any are chosen, and of their lifecycle data, kept with the time it ran. The dashboard always shows the last Scan.
_Avoid_: Refresh, sync, check

**Stale**:
A part of the last Scan or Discovery that could not be read, shown with the result of its last successful read and when that was.
_Avoid_: Cached, outdated

### Lifecycle

**Active support**:
The period in which a Release Cycle still gets regular fixes, not only security fixes. Not every Product has one.

**End of life**:
The date a Release Cycle loses standard support. For an AWS Product this is the end of AWS standard support, even when paid Extended Support continues after it. For a Lambda runtime it is the runtime's deprecation date.
_Avoid_: EOL date, sunset, deprecation

**Extended Support**:
Paid support AWS gives a Release Cycle after its End of life. AWS enrolls a Component into it automatically, unless Extended Support is disabled for that Component, in which case AWS upgrades it at End of life instead.

**Status**:
Where a Component stands against its Release Cycle's dates: Current, Falling behind, AWOL, or Untracked. AWS's own dates decide it where AWS publishes them, and endoflife.date's dates everywhere else.

**Current**:
The Status of a Component that is neither Falling behind nor AWOL, including one whose Release Cycle has no End of life announced yet.

**Falling behind**:
The Status of a Component whose Release Cycle has left Active support, or reaches End of life within 180 days.
_Avoid_: Outdated, at risk, expiring

**AWOL**:
The Status of a Component whose Release Cycle is past End of life, including one running on Extended Support.
_Avoid_: Unsupported, expired, dead

**Untracked**:
The Status of a Component that cannot be matched to a Release Cycle, such as one that reports no version or runs a Product with no known lifecycle.
_Avoid_: Unknown, unmatched, N/A

**Urgency order**:
Components ordered by Status (AWOL, Falling behind, Current, Untracked) and then by soonest End of life, with no End of life last.
_Avoid_: Default order, priority, most urgent first

### Drift

**Latest patch**:
The newest version of the line a Component's Release Cycle belongs to. RDS MySQL Release Cycle 8.4.7 belongs to the 8.4 line, so its Latest patch is 8.4's, not 8.4.7 itself.

**Newest cycle**:
The most recent Release Cycle of a Component's Product. For a Lambda runtime it is the most recent runtime of the same language: python3.9's is python3.14, not the newest Node.js or Java runtime.
_Avoid_: Latest version, latest major

**Newest offered**:
The most recent version AWS currently offers for a Component's Product in the Component's region.
_Avoid_: Latest available, default version

**Drift**:
How far a Component's version is behind the Latest patch, the Newest cycle, and the Newest offered version. Drift is shown alongside Status and never changes it.
