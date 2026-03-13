# JM Dashboard

A Railway-hosted monthly bills tracker built from the shared spreadsheet.

## Current stack

- Mobile-first HTML, CSS, and browser JavaScript
- Node HTTP server for static files and JSON API routes
- Railway Postgres for persistent bill storage

## Core behavior

- Edit bill names and amounts
- Mark bills paid or unpaid
- Reset the month in one tap
- Automatically recalculate still-due total and tithes
- Save every change to the live database

## Railway services

- `web` for the app
- `Postgres` for storage

## Custom domain

Run a Railway domain attach once you know the exact hostname you want, for example a subdomain like `bills.example.com`.
