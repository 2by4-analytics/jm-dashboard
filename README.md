# Railway Expenses Balance

This is a Railway-deployable web app version of the shared Google Sheet.

## What it replicates

- The original bill list
- A YES / NO paid status for each bill
- Total Due Monthly As Of today based on unpaid bills
- Tithes equal to 10% of paid bills
- A usage guide alongside the tracker

## Local behavior

- Data is stored in browser localStorage
- Bill names and amounts are editable
- New bills can be added without changing formulas manually
- Reset Month changes every bill back to NO

## Deploying to Railway

1. Create a new Railway project from this folder or Git repo.
2. Railway will detect the Dockerfile.
3. Deploy the app and expose the generated service.

The container serves the app over port 80.
