# Canteen Tracking System --- Product & Build Specification

**Document purpose:** Handoff specification for Codex to design and
implement the Phase 1 web application.

**Status:** Phase 1 requirements locked\
**Primary goal:** Replace fragmented Google Sheets and handwritten daily
food-waste tracking with a simple, reliable web application.

------------------------------------------------------------------------

## 1. Product Goal

Build a responsive web application for daily canteen operations that
tracks:

-   Food-box production by batch
-   Current stock by production batch
-   Expiry dates and expiring food
-   Daily sold quantity
-   Daily food waste
-   Expenses and receipt photos
-   Stores / purchase sources
-   Daily closing and reconciliation
-   Reports and dashboard metrics
-   Full activity/audit history for important changes

The system must prioritize **ease of use for first-time and
non-technical users**.

This should **not** feel like an ERP system.

A new staff member should be able to record production, record waste,
add an expense, and complete daily closing with minimal or no training.

------------------------------------------------------------------------

## 2. Core Design Principles

1.  **Simple first**
    -   Minimize required fields.
    -   Avoid exposing database concepts to normal users.
    -   Common daily actions should require as few clicks as possible.
2.  **Mobile/tablet friendly**
    -   The application is web-based.
    -   It must work well on desktop, tablet, and mobile.
    -   Daily operations should be practical from a phone.
3.  **Prevent errors instead of only reporting them**
    -   Validate stock calculations.
    -   Warn about expiry.
    -   Detect closing discrepancies.
    -   Confirm destructive actions.
4.  **Never silently lose operational data**
    -   Use soft delete for important business records.
    -   Keep an audit log for create/edit/delete/restore actions.
5.  **Automate calculations**
    -   Staff should enter observations such as produced quantity,
        waste, and remaining stock.
    -   The system should calculate derived values where possible.
6.  **Phase 1 must remain focused**
    -   Do not add complex accounting, ingredient inventory, AI receipt
        reading, or POS integration yet.
    -   Prepare the data model for future expansion without exposing
        unnecessary UI.

------------------------------------------------------------------------

## 3. Current Pain Points

Current operations use Google Sheets plus handwritten waste forms.

Problems include:

-   Expenses cannot be tracked consistently.
-   Store/category names are inconsistent.
-   Expense data is split across sheets.
-   Food waste is manually written on paper.
-   Staff need to wait until kitchen closing around **19:00** to know
    the final remaining/sold quantities.
-   Food may remain for approximately 2--3 days, making expiry tracking
    difficult.
-   Remaining food may belong to different production batches.
-   Historical changes/deletions are difficult to trace.
-   Management cannot easily see current stock, waste trends, or
    upcoming expiry.

Historical spreadsheet data does **not** need an import tool for
Phase 1. It will be entered manually if required.

------------------------------------------------------------------------

# 4. Phase 1 Navigation

Keep primary navigation small:

1.  **Dashboard**
2.  **Production**
3.  **Stock**
4.  **Waste**
5.  **Expenses**
6.  **Reports**
7.  **Manage**

Under **Manage**:

-   Menu Items
-   Stores
-   Activity Log
-   Settings

Do not clutter the primary navigation with administrative pages.

------------------------------------------------------------------------

# 5. Dashboard

The Dashboard is an analysis-only overview. It should answer:

> How much food was prepared, sold, left in stock, spent, and wasted today?

## 5.1 Today Summary

Display the day's analytical totals:

-   Produced today
-   Inferred sold today
-   Available stock
-   Waste today
-   Waste rate
-   Expenses today

The waste rate uses today's active waste quantity divided by today's recorded
production, consistent with the Reports page. If no production was recorded,
show the rate as unavailable instead of `0%`.

## 5.2 Dashboard Details

Selecting a summary metric opens its relevant details in an on-screen dialog,
without making staff scroll down the dashboard. Produced, sold, stock, waste,
waste-rate, and expense metrics each open their corresponding records. The
dialog stays within the viewport; long lists scroll inside the dialog. On a
phone, the dialog uses nearly the full screen and has a large close target.
Each detail row includes the food or store, relevant batch or category,
quantity or amount, and record time where applicable. Waste rows include the
recorded reason and optional note. Closing rows show expected quantity,
physical count, inferred sales, and any adjustment reason.

Each detail section shows a useful empty state when it has no records and
links to its dedicated workflow. Archived records are excluded, matching the
dashboard totals. Inferred sales are included only after a closing is closed;
a reopened closing is identified and is not counted as completed sales.

The waste detail rows include:

-   Food name and production-batch date
-   Wasted quantity
-   Recorded reason and optional note
-   Record time in Bangkok time

Workflow actions, checklist items, stock lists, expiry attention, and recent
activity remain available from their dedicated pages and navigation rather
than appearing on the analysis dashboard.

------------------------------------------------------------------------

# 6. Menu Management

Users must be able to add and manage food-box menu items without
developer assistance.

Fields:

-   Menu name
-   Default shelf life in days
-   Active / inactive
-   Optional notes
-   Future/reserved: selling price
-   Future/reserved: estimated cost per box

Example:

``` text
Menu: Chicken Rice
Default shelf life: 3 days
Status: Active
```

Do not permanently delete a menu that has historical transactions.

Use inactive/archive status or soft deletion.

The application must support different shelf lives by menu, even if
initially many menus use the same shelf life.

------------------------------------------------------------------------

# 7. Store Management

Expenses require a controlled store/source list.

Initial examples:

-   Makro
-   Rimping
-   7-Eleven
-   Lotus Go Fresh
-   Online Shopping
-   Other

Users must be able to:

-   Add store
-   Rename store
-   Activate/deactivate store

The expense form should include:

``` text
Store ▼
+ Add new store
```

Avoid duplicate variants such as:

``` text
Makro
Normal makro
Makro&Rimping
```

If practical, warn when a newly entered store name is very similar to an
existing one.

------------------------------------------------------------------------

# 8. Daily Production

Food is produced every day and must be recorded by batch.

## 8.1 Production Entry

Fields:

-   Date produced
-   Menu
-   Quantity produced
-   Expiry date
-   Notes (optional)

Example:

``` text
Chicken Rice
Produced: 20 boxes
Production date: 07 Oct 2026
Expiry: 10 Oct 2026
```

## 8.2 Automatic Expiry

Each menu has a default shelf life.

Example:

``` text
Production date = 07 Oct
Default shelf life = 3 days
Suggested expiry = 10 Oct
```

The expiry field must remain editable because individual batches may
have different expiry dates.

Do not assume every menu always has the same shelf life.

## 8.3 Batch Identity

Every production entry creates a distinct batch.

Example conceptual identifier:

``` text
Chicken Rice
Batch #102
Produced 07 Oct
Expires 10 Oct
```

Users do not need to understand internal database IDs.

## 8.4 Copy Yesterday

Provide a convenience action:

`Copy yesterday's menu`

Example:

Yesterday:

``` text
Chicken Rice       20
Basil Chicken      15
Pasta              10
```

Today the user can copy these menu rows and only change
quantities/expiry where necessary.

This must create new production batches, not duplicate historical
records.

------------------------------------------------------------------------

# 9. Current Stock

Provide a simple current inventory view.

Example:

``` text
Chicken Rice                    13 boxes

Batch 06 Oct                     3
Expires 09 Oct

Batch 07 Oct                    10
Expires 10 Oct
```

Staff can distinguish remaining boxes by production batch.

Do **not** force FIFO allocation because staff are able to identify
which physical batch remains.

The UI may suggest older batches first, but the user must be able to
choose the actual batch.

Stock should be calculated from the ledger/transactions rather than
maintained as an independently editable number whenever possible.

Conceptually:

``` text
Produced
- Sold/closing allocation
- Waste
- Other approved adjustments
= Current Stock
```

Avoid negative stock.

------------------------------------------------------------------------

# 10. Expiry Management

Leftover food may continue to be sold on following days until its
expiry.

The system must automatically determine expiry status from each batch.

Views should support:

``` text
Expired
Expires today
Expires tomorrow
Normal
```

## Important Rule

**Do not automatically convert expired food into waste.**

When food expires, mark the batch as expired/attention required.

Staff then confirms what happened, for example:

``` text
Dispose → Record as Waste
```

This prevents incorrect waste records from being generated
automatically.

------------------------------------------------------------------------

# 11. Waste Tracking

Replace the handwritten waste workflow.

## 11.1 Record Waste

Fields:

-   Date/time
-   Menu
-   Production batch
-   Quantity
-   Reason
-   Notes
-   Optional photo

Waste reasons:

-   Expired
-   Spoiled
-   Damaged
-   Quality Issue
-   Other

Example:

``` text
Chicken Rice
Batch: 07 Oct
Waste: 2 boxes
Reason: Expired
```

Waste must reduce available stock for the selected batch.

Prevent waste quantity from exceeding available batch stock.

## 11.2 Waste Photo

Photo is optional.

It may be useful for unusual events such as:

``` text
10 boxes spoiled
Reason: Refrigerator problem
```

Do not require a photo for normal daily waste because that would slow
down the workflow.

------------------------------------------------------------------------

# 12. Daily Closing

Kitchen closing is approximately **19:00**.

The system must provide a dedicated `Close Today` workflow.

The closing process should be extremely simple and ideally take
approximately 1--2 minutes.

## 12.1 Closing Calculation

Conceptual equation:

``` text
Opening Stock
+ Produced Today
- Waste
- Sold
= Remaining
```

Staff records the physical remaining quantities.

The system derives sold quantity where sufficient data exists.

Example:

``` text
Available: 30
Waste:      2
Remaining:  8

Calculated Sold: 20
```

## 12.2 Batch-Level Closing

Because staff can distinguish batches, remaining stock should be
recorded/confirmed at batch level where necessary.

Example:

``` text
Chicken Rice

Batch 06 Oct
Expected available: 5
Remaining: 2

Batch 07 Oct
Expected available: 20
Remaining: 8
```

The system can then correctly carry each batch into the next day.

## 12.3 Reconciliation

The application must detect discrepancies.

Example:

``` text
⚠ Stock difference: 2 boxes
```

If physical stock does not reconcile with recorded transactions, require
either:

-   Correction of incorrect data, or
-   An adjustment with a reason

Example reasons:

-   Counting correction
-   Staff meal
-   Complimentary
-   Missing/unrecorded
-   Other

Every adjustment must be included in the Activity Log.

## 12.4 Closing State

A day should have a state such as:

-   Open
-   Closed
-   Reopened

If a closed day is reopened/edited, record the event in the audit log.

------------------------------------------------------------------------

# 13. Expenses

Expense tracking is intentionally simple in Phase 1.

## 13.1 Add Expense

Fields:

-   Date
-   Store
-   Category
-   Amount (THB)
-   Receipt photo
-   Notes

Example:

``` text
Date:       07/10/2026
Store:      Makro
Category:   Ingredients
Amount:     ฿2,223
Receipt:    [image]
Notes:      Weekly ingredients
```

Do not require itemized receipt entry.

A Makro receipt for ฿2,223 is stored as one expense.

## 13.2 Expense Categories

Support configurable categories, with at least:

-   Ingredients
-   Packaging
-   Other

Keep the category structure extensible.

## 13.3 Receipt Storage

Phase 1 only needs:

-   Photo upload
-   Photo preview
-   Photo retrieval

Do not implement AI/OCR receipt extraction in Phase 1.

Future versions may extract:

-   Store
-   Date
-   Total amount

------------------------------------------------------------------------

# 14. Activity / Audit Log

Auditability is a Phase 1 requirement.

Record important:

-   Create
-   Edit
-   Delete/soft delete
-   Restore
-   Stock adjustment
-   Daily close
-   Reopen day

Store where relevant:

-   Timestamp
-   Action
-   Entity type
-   Entity ID
-   Human-readable description
-   Previous values
-   New values
-   User identity if authentication is implemented

Examples:

``` text
15:21 Added Chicken Rice — 20 boxes

15:25 Added expense
Makro — ฿2,223

19:12 Edited Chicken Rice remaining quantity
8 → 7 boxes

19:14 Deleted expense #EXP-104
฿350

19:16 Restored expense #EXP-104
```

Audit records should not be editable by normal users.

------------------------------------------------------------------------

# 15. Delete / Restore Strategy

Use soft deletion for business-critical records where practical.

When a user deletes something:

1.  Ask for confirmation.
2.  Hide it from normal operational views.
3.  Preserve the record.
4.  Write an audit event.
5.  Allow restore where safe.

For immediate accidental deletion, optionally show:

``` text
Production deleted. Undo
```

Do not allow deletion to silently corrupt stock history.

If deleting a transaction would invalidate later stock calculations,
either prevent deletion or perform a controlled reversal/adjustment.

------------------------------------------------------------------------

# 16. Reports

Support:

-   Daily
-   Weekly
-   Monthly
-   Custom date range

Metrics:

-   Total produced
-   Total sold
-   Current/remaining stock
-   Total waste
-   Waste %
-   Expired quantity
-   Expenses
-   Expenses by store
-   Expenses by category

Useful visualizations:

-   Production vs Sold vs Waste
-   Waste trend
-   Expense trend
-   Expense by store
-   Waste by menu
-   Waste by reason

Keep charts simple and readable.

------------------------------------------------------------------------

# 17. Export

Managers should be able to export operational data.

At minimum support CSV.

Excel/XLSX may also be supported if straightforward.

Exportable datasets:

-   Expenses
-   Production
-   Stock
-   Waste
-   Daily closing
-   Activity log

The application must not trap operational data inside the system.

------------------------------------------------------------------------

# 18. Future-Ready Fields

Prepare architecture/data model for future functionality without
cluttering Phase 1 UI.

Potential future features:

-   Selling price
-   Revenue
-   Ingredient/recipe costing
-   Cost per box
-   Food cost %
-   Waste cost
-   Gross profit
-   POS integration
-   Supplier management
-   AI/OCR receipt extraction
-   Advanced permissions
-   Automated notifications

Do not implement these unless required for sound architecture.

------------------------------------------------------------------------

# 19. Suggested Data Model

Exact implementation may vary, but the domain should roughly include:

## `menus`

-   id
-   name
-   default_shelf_life_days
-   active
-   notes
-   selling_price (nullable / future)
-   estimated_cost_per_box (nullable / future)
-   created_at
-   updated_at
-   deleted_at

## `stores`

-   id
-   name
-   active
-   created_at
-   updated_at
-   deleted_at

## `expense_categories`

-   id
-   name
-   active

## `expenses`

-   id
-   expense_date
-   store_id
-   category_id
-   amount_thb
-   receipt_url
-   notes
-   created_at
-   updated_at
-   deleted_at

## `production_batches`

-   id
-   menu_id
-   production_date
-   quantity_produced
-   expiry_date
-   notes
-   created_at
-   updated_at
-   deleted_at

## `waste_records`

-   id
-   waste_date
-   production_batch_id
-   quantity
-   reason
-   notes
-   photo_url
-   created_at
-   updated_at
-   deleted_at

## `daily_closings`

-   id
-   business_date
-   status
-   closed_at
-   reopened_at
-   notes

## `closing_batch_counts`

-   id
-   daily_closing_id
-   production_batch_id
-   expected_quantity
-   physical_remaining_quantity
-   calculated_sold_quantity

## `stock_adjustments`

-   id
-   production_batch_id
-   business_date
-   quantity_delta
-   reason
-   notes
-   created_at

## `activity_logs`

-   id
-   timestamp
-   user_id (nullable depending on auth)
-   action
-   entity_type
-   entity_id
-   description
-   before_data JSON
-   after_data JSON

## `settings`

Possible values:

-   kitchen_closing_time
-   default_shelf_life_days
-   timezone
-   currency

Default timezone should support Bangkok/Thailand operations.

Currency:

``` text
THB
```

------------------------------------------------------------------------

# 20. Important Business Rules

1.  Food can remain in stock across multiple days until expiry.
2.  Staff can distinguish which production batch remaining boxes belong
    to.
3.  Do not blindly allocate remaining/sold stock using FIFO.
4.  A batch has its own production date and expiry date.
5.  Default expiry can be generated from the menu shelf life but must be
    editable.
6.  Expired food is **not automatically waste**.
7.  Waste must reference a batch whenever possible.
8.  Waste cannot exceed available batch quantity.
9.  Stock should never silently become negative.
10. Closing discrepancies must be surfaced.
11. Important edits/deletions must be auditable.
12. Expense receipts are recorded as total receipt amounts, not
    individual ingredients.
13. Historical Google Sheet import is out of scope.
14. Revenue/profit functionality is future scope.

------------------------------------------------------------------------

# 21. UX Requirements

This section is critical.

## Target User

Assume the user:

-   May be using the system for the first time
-   May not be technical
-   May be busy in a kitchen
-   May be using a phone
-   Should not need to understand inventory accounting

## UX Rules

-   Large touch-friendly controls.
-   Clear labels.
-   Avoid technical terminology.
-   Use sensible defaults.
-   Keep required fields minimal.
-   Show important warnings at the moment action is needed.
-   Prefer dropdown/search over free-text when data should be
    standardized.
-   Provide inline `+ Add` actions for menu/store creation.
-   Confirm destructive actions.
-   Preserve form data when validation fails.
-   Make success state obvious.
-   Avoid modal chains.
-   Do not require unnecessary page navigation.
-   Provide useful empty states.
-   Optimize daily closing for speed.

Example:

Bad:

``` text
Inventory Transaction Allocation
```

Prefer:

``` text
How many boxes are left?
```

Bad:

``` text
Create Production Batch Entity
```

Prefer:

``` text
Add today's food
```

------------------------------------------------------------------------

# 22. Responsive Layout

## Desktop

Primary sidebar/navigation with dashboard cards and tables.

## Mobile

Use compact navigation/bottom navigation where appropriate.

Prioritize:

-   Add Production
-   Record Waste
-   Add Expense
-   Close Today

Forms should work comfortably one-handed where practical.

Receipt and waste photos should support direct mobile camera/file
upload.

------------------------------------------------------------------------

# 23. Suggested Dashboard Structure

``` text
-------------------------------------------------
Daily analysis                  07 Oct 2026
-------------------------------------------------

Produced        Sold         Available stock
   45            32                 10

Waste today     Waste rate       Expenses
    3 boxes        7%             ฿2,223

Selecting a metric opens its production, waste, closing, expense, or
stock-by-batch details in an on-screen dialog.
-------------------------------------------------
```

This is conceptual, not a strict visual design requirement.

------------------------------------------------------------------------

# 24. Phase 1 Acceptance Criteria

Phase 1 is considered successful when a user can:

-   Add a new menu.
-   Add a new store.
-   Record today's food production.
-   Automatically receive a suggested expiry date.
-   Override expiry when needed.
-   See current stock by menu and batch.
-   See expiring and expired batches.
-   Record waste against a batch.
-   Add an expense and receipt photo.
-   Complete daily closing.
-   Record remaining stock by batch.
-   Have sold quantity calculated.
-   Be warned when closing numbers do not reconcile.
-   Record a justified stock adjustment.
-   View daily/weekly/monthly summaries.
-   View activity history.
-   Safely delete/restore supported records.
-   Export core data.
-   Complete common workflows comfortably on mobile.

Most importantly:

> A new staff member should be able to understand the main daily
> workflow without reading a manual.

------------------------------------------------------------------------

# 25. Out of Scope for Phase 1

Do **not** expand scope during implementation unless explicitly
requested.

Out of scope:

-   Ingredient-level inventory
-   Recipe/BOM management
-   Full accounting
-   POS integration
-   AI/OCR receipt reading
-   Automatic revenue calculation
-   Complex roles and permissions
-   Supplier procurement workflow
-   Automatic historical Google Sheet migration

------------------------------------------------------------------------

# 26. Recommended Implementation Order

### Milestone 1 --- Foundation

-   App shell
-   Database
-   Menu management
-   Store management
-   Expense categories
-   Basic audit logging

### Milestone 2 --- Production & Stock

-   Production entry
-   Batch system
-   Automatic expiry
-   Current stock
-   Expiry statuses
-   Copy yesterday

### Milestone 3 --- Waste

-   Waste recording
-   Batch deduction
-   Waste reasons
-   Optional photo
-   Validation

### Milestone 4 --- Daily Closing

-   Physical remaining counts
-   Batch-level closing
-   Sold calculation
-   Reconciliation
-   Adjustments
-   Close/reopen state

### Milestone 5 --- Financial Tracking

-   Expenses
-   Receipt upload
-   Expense history
-   Store/category filtering

### Milestone 6 --- Dashboard & Reports

-   Today summary
-   Today checklist
-   Expiry attention
-   Recent activity
-   Reports
-   Export

### Milestone 7 --- UX & Reliability

-   Mobile optimization
-   Loading/error/empty states
-   Undo/restore
-   Validation
-   Audit coverage
-   End-to-end workflow testing

------------------------------------------------------------------------

# 27. Codex Implementation Instructions

Before implementation:

1.  Inspect the existing repository if one exists.
2.  Do not replace working architecture without a concrete reason.
3.  Produce a short implementation plan.
4.  Identify database migrations required.
5.  Implement incrementally following the milestones above.
6.  Verify each milestone before moving to the next.
7.  Avoid introducing features outside this specification.

When ambiguity exists:

-   Prefer the simplest workflow for kitchen staff.
-   Do not invent complex business rules.
-   Preserve auditability.
-   Preserve historical data.
-   Ask for clarification when a decision would materially affect stock
    or financial correctness.

## Engineering priorities

In order:

1.  Data correctness
2.  Simple UX
3.  Auditability
4.  Mobile usability
5.  Performance
6.  Visual polish

## Required testing focus

Test at minimum:

-   Multiple batches of the same menu across different days
-   Different expiry dates for the same menu
-   Waste from an older batch
-   Stock carried into the following day
-   Daily closing with multiple batches
-   Closing discrepancy
-   Editing previous records
-   Soft deletion/restoration
-   Expired batch handling
-   Preventing negative stock
-   Receipt upload
-   Mobile daily workflow

------------------------------------------------------------------------

# 28. Definition of Done

Do not consider Phase 1 complete merely because pages exist.

Phase 1 is complete when the following real workflow works end-to-end:

``` text
Create menu
    ↓
Produce food
    ↓
System creates batch + expiry
    ↓
Food remains across days
    ↓
Record waste against correct batch
    ↓
Add daily expenses + receipt
    ↓
19:00 physical count
    ↓
Close day
    ↓
System calculates sold quantity
    ↓
Carry correct batches forward
    ↓
Flag upcoming expiry
    ↓
Dashboard/report reflects all changes
    ↓
Activity log explains important changes
```

The result should be a **simple daily operations tool**, not merely a
collection of CRUD pages.
