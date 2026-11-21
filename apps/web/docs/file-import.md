# File import screens

The statement file import's screens on Connections. The design rules they follow are in `DESIGN.md` (File import, Alerts); the API behind them is `apps/api/docs/file-import.md`.

Statement file import lives on Connections, and only while the deployment has it on: the import
list answering is the switch, and until it does the page shows nothing of it. Bank sync stays
the page's primary action. **Import a file** is the outline button beside **Connect a bank**
(the two share the row under the title on phones, equal width), and the empty page offers both.
No copy calls import a fallback or assumes a bank is connected.

- **Drop area.** On fine pointers: a 160px area with a dashed 1px rule at control radius, the
  `FileUp` Clay tile, "Drop statement files here", a muted "or" and an outline **Choose files**.
  Drag-over turns the rule to the ring token and the field to the accent wash. Phones and touch
  screens get the button alone, full width. The picker accepts any extension, since banks name
  their exports oddly. Files dragged anywhere over Connections show a full-column overlay (dashed
  2px ring rule, page-field wash, "Drop to import"); it is the only drop target outside the dialog.
- **One dialog.** Choosing, importing, the summary, the account question, the rows to check and
  the undo confirmation are steps of one `ResponsiveDialog`, with a scrolling body and a footer
  that stays in reach. It never closes by itself. Closing it does not cancel an upload; the
  outcome then arrives as a toast (View reopens the summary). Focus returns to Import a file.
- **Refusals.** A drop is all or nothing, so a refusal is a `destructive` `Alert` whose
  description ends with "Nothing was imported." It sits at the end of the choose step, under
  Supported files, and names the refused file when the drop held several. An offer to work out
  a file's columns is a `default` Alert, and every answer from working them out is shown the
  same way; the footer carries the action. A choice over a drop's limits (20 files, 10 MB each,
  25 MB together) is refused the same way before anything is uploaded. A failed request is a
  `destructive` Alert in the same place with the cause, the status line and Try again.
- **Summary.** Counts as a bordered `divide-y` list with `numeric` values (the count that needs a
  look in `warning`), then Period and Went to, each a small muted label with its glyph
  (`CalendarRange`, `ArrowDownToLine`) over its value. Each account it went to shows as on
  Connections: its bank's logo (imported files: the `Files` Clay tile) with the account-type tile
  on its corner, its name, and its details and bank under it. A drop that added nothing shows
  the `CheckCheck` state instead of the counts. Skipped days get a `warning` Alert (`FileWarning`, "Some days are missing")
  under the counts: each gap's days, the account under them when the drop went to several, and
  "-€1,200.00 missing" on the right in a `numeric` column; a gap split by sync coverage shows its
  whole amount on both lines. Rows on days bank sync is final for that the bank
  never sent sit under the counts as one bordered fold line ("Not added: 4 rows your bank never
  sent", `ChevronRight`), never in the attention tone and never counted as a look: nothing waits
  for the user. Opened, a muted line says the bank sent every transaction for those days, then the
  rows grouped by counterparty (else description), largest group first: one bordered block per
  group (the `FileX` Clay tile, the name, its row count and **Add N** while more than one is open),
  its rows under it with **Add** each. Both are small outline buttons of one minimum width in one
  right-hand column, so their right edges line up. An added row turns into a muted "Added". Nothing
  adds every row at once. Rows of the import a later sync removed get a second fold line just like
  it ("Removed: 4 rows your bank never sent"), whose list says the bank sent every transaction for
  those days, so Tempo removed the file's copies, and offers
  **Add back** and **Add back N**, a removed row turning into "Added back". Only the summary shows
  removed rows; the list of imports does not. 50 groups show, then **Show 50 more**; a group
  shows 5 rows, then **Show all**. An undone import opens with a `default` Alert
  (`Undo2`) saying when and what the undo removed, and its counts sit muted under "When
  imported" in the past tense.
- **Account question.** Native radio rows, so arrow keys move between them; nothing is
  preselected, and Import stays disabled until every question has an answer. Each row starts
  with its bank's logo as on its Connections card (imported files: the `Files` Clay tile) and a
  small round account-type tile on its corner as on its Connections row; a new account gets the
  `Plus` Clay tile in the same square.
- **Balances.** The amount field shows its currency inside at the far right, over padding the
  value scrolls short of. Save sits under the field: in the summary on its own row, in the
  Add/Edit balance dialog in its footer with Cancel.
- **Rows to check.** Each file row (the `FileQuestion` tile) and the stored rows it could be form one
  bordered block: one radio choice between those rows and "It's a new transaction", nothing
  preselected. Radios take the tile's lead column and amounts share one right-aligned column, with
  nothing after them; each stored row says how its day sits against the file row's ("2 days
  later"). Choices change freely until Save, which stays in reach under the list and sends only the
  rows with one. A saved answer is final and collapses its block to one muted line; a failed one
  stays open with its choice and an error line, or, when the shared toast already reported the
  failure (offline, signed out, rate limited), with its choice alone. A long list shows 50 rows, then a ghost **Show 50
  more** (as Load more) under them; it focuses the first row it adds, and choices on every shown
  row count toward Save. When every row is on a synced account, a second muted line under the
  intro says they are almost always in Tempo already and leaving them open loses nothing.
- **Imports list.** Under the connection cards once an import exists: a small heading, then one
  bordered `divide-y` list, newest first, five rows before Show all. A row reads "3 files · 212
  new" over the day, the accounts and any rows still to check (attention tone), with an
  always-visible outline Undo named with its date. An undone import stays listed, muted, without
  the button. Undo confirms with the destructive variant and says what goes and what stays.
- **Column preview.** The bank a layout is saved under is a `Select` labelled Bank: the owner's own banks
  (`GET /bank-imports/layout-proposals/:proposalId/banks`: their connected or once-connected banks, the
  banks their imported-files accounts record by name and their saved layouts' banks; only names this
  proposal's confirmation accepts, so never Revolut, a name over 60 characters, or, for a file naming no
  account, a bank whose built-in export names none),
  then a separator and **Other**, which reveals a "Bank name" input (60 characters at most). While the
  list loads the picker is disabled and reads "Loading your banks…"; once Looks right is pressed it is not read again; a failed load takes its place as a section `LoadErrorState`
  ("Couldn't load your banks", Try again) and no toast (`quiet`), and Looks right stays disabled until it loads.
  Tempo's guess starts picked when it names a listed bank (ignoring case and spacing), else Other with
  the guess typed in; with no guess nothing is picked and Looks right stays disabled. A name the API
  refuses says why under the control.
- **Imported files.** The imported-files connection uses the bank card with the `Files` Clay tile
  and "From statement files". It never shows consent, sync or re-authorization states, and its
  Details hold the accounts and Remove only.
