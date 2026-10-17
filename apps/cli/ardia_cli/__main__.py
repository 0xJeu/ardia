import os
import sys

lease = os.environ.pop("ARDIA_CLI_LEASE", None)
try:
    from ardia_cli.cli import main

    status = main()
finally:
    if lease:
        try:
            os.unlink(lease)
        except OSError:
            pass
sys.exit(status)
