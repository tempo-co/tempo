# File import screens

The statement file import's screens, in the Add data sheet. The design rules they follow are in `DESIGN.md` (File import, Alerts); the API behind them is `apps/api/docs/file-import.md`.

Statement file import runs in the Add data sheet, on any signed-in page, and only while the
deployment has it on: the import list answering is the switch, and until it does the app shows
nothing of it (Add data then opens Connect a bank alone). Add data in the sidebar or the phone
header opens the sheet on its ways in, **Import a statement file** and **Connect a bank**; the
first step of each goes back to them. On Accounts, **Import a file** is the outline button beside
**Connect a bank** (the two share the row under the title on phones, equal width), the empty page
offers both, and each opens the sheet at its own first step; an account page's **Import a newer
file** does too. No copy calls import a fallback or assumes a bank is connected.

- **Bank picker.** Import a file starts at "Which bank is the file from?", built from Connect a
  bank's picker parts: the country row (flag, name, **Change** to a country step that lists the
  EEA, Switzerland and the United Kingdom with their listed banks' counts), a search that is never
  focused for the owner, and one scrolling list of 56px rows. The country is the browser's region
  when listed, else the country of the account's time zone when listed, else the first by name,
  and it stays while the sheet closes and opens. The list holds that country's banks from the shared bank list (`BANK_LIST` in `@wisp/contracts`), then
  the banks that serve several countries from one app ("Several countries" under the name), then
  Another bank under a hairline. A search matches names and countries across every country and
  always keeps Another bank. Whether a bank is verified shows nowhere in the list. Each row leads
  with the logo Connect a bank shows for the connectable bank of the same name (ignoring case,
  spacing and a note in brackets) in the bank's country, or its `logoCountry` for a bank of
  several countries; a bank without one, and Another bank, get the plain bank glyph on the same
  plate. Picking a bank leads to the file choice, which opens with the bank's logo and name,
  **Change** back to the picker while no files are kept, its numbered export steps and the file to
  pick. For an unverified bank one muted line says no file of it has been seen yet and that its
  columns may need checking once. Another bank shows one generic text instead. The picked bank's
  id goes as `bankId` with the upload and with working out the columns. A page drop skips the
  picker and sends no bank.
- **Tell us your bank.** A file Wisp cannot read (its columns could not be worked out, the owner
  said the worked-out ones were not right, or this deployment cannot work them out) offers an
  outline **Tell us your bank** in the footer. Its step asks for the bank name (the picked bank's
  when it is listed), the country (a `Select` of the EEA, Switzerland and the United Kingdom, the
  picked bank's or the browser's region preselected) and the files the bank lets you download
  (an outline toggle group, several at once). Send stays disabled until all three are given. It
  posts JSON to `POST /bank-imports/bank-requests` with no file, and the form says the file isn't
  sent and no reply comes. The sent state says so again, with Done.
- **Drop area.** On fine pointers: a 160px area with a dashed 1px rule at control radius, the
  `FileUp` leading tile, "Drop statement files here", a muted "or" and an outline **Choose files**.
  Drag-over turns the rule to the ring token and the field to the accent wash. Touch screens and
  windows narrower than 768px get a default `Alert` (`Info` glyph) that banking apps usually
  can't export a statement but the bank's website can, then **Choose the file** alone, full width. The picker accepts any extension, since banks name
  their exports oddly. Files dragged over any signed-in page show a full-column overlay (dashed
  2px ring rule, page-field wash, "Drop to import") while the sheet is closed and no import runs;
  a drop opens the sheet and reads the files at once. It is the only drop target outside the sheet.
- **Check what we found.** Every drop is read first (`POST /bank-imports/preview`, "Finding
  accounts and dates…") and imported only from this step: a line with the drop's transactions and
  days ("Rename an account if you like"), then one bordered block per account it goes to, in the
  summary's order: a name field (labelled "Name of account N", the account's name as Accounts
  shows it), a `secondary` `New` or `Matched` badge, and a muted line with the bank, the account's details,
  currency, its transactions and days. A muted line says the import can be undone from Accounts,
  and the footer holds one **Import N transactions**. A name changed there is saved as the
  account's own name once the import is in (the same write as Rename on Accounts: left empty or
  typed as the account's own name, it goes back to that name; unchanged, nothing is saved), and a failed save says so in a toast. An import
  refused as busy or failed for a lost connection stays on this step with the names typed, its
  `Alert` (none when the shared toast already said so), and Import or Try again imports it as it
  is; Add data reopens it there, and so does Check on the failure's toast when one shows. The back
  arrow returns to the files. The account question's **Continue**, a page drop and Looks right
  after working out the columns all come back here.
- **First run.** While the empty Home shows, Add data opens the same steps in a centred dialog
  (a bottom sheet on phones) instead of the side sheet. Its import shows "Building your Home", then
  the dialog closes on the filled Home once the account list has the new accounts, and the summary
  arrives as the toast.
- **One sheet.** Choosing, reading, Check what we found, importing, working out and checking the
  columns, the account question, the summary (with the rows the bank never sent and the balance), the rows to check
  and the undo confirmation are steps of the Add data sheet (a side sheet on desktop, one bottom sheet on
  phones), each with a scrolling body and a footer that stays in reach. It closes by itself only after a first run's import.
  Closing it does not cancel an upload; the outcome then arrives as a toast (Check reopens Check what we found, View the
  summary), and Add data reopens at a running import or a refusal that kept its files. Focus
  returns to whatever opened it.
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
  Accounts: its bank's logo (imported files: the `Files` leading tile) with the account-type tile
  on its corner, its name, and its details and bank under it. A drop that added nothing shows
  the `CheckCheck` state instead of the counts. Skipped days get a `warning` Alert (`FileWarning`, "Some days are missing")
  under the counts: each gap's days, the account under them when the drop went to several, and
  "-€1,200.00 missing" on the right in a `numeric` column; a gap split by sync coverage shows its
  whole amount on both lines. Rows on days bank sync is final for that the bank
  never sent sit under the counts as one bordered fold line ("Not added: 4 rows your bank never
  sent", `ChevronRight`), never in the attention tone and never counted as a look: nothing waits
  for the user. Opened, a muted line says the bank sent every transaction for those days, then the
  rows grouped by counterparty (else description), largest group first: one bordered block per
  group (the `FileX` leading tile, the name, its row count and **Add N** while more than one is open),
  its rows under it with **Add** each. Both are small outline buttons of one minimum width in one
  right-hand column, so their right edges line up. An added row turns into a muted "Added". Nothing
  adds every row at once. Rows of the import a later sync removed get a second fold line just like
  it ("Removed: 4 rows your bank never sent"), whose list says the bank sent every transaction for
  those days, so Wisp removed the file's copies, and offers
  **Add back** and **Add back N**, a removed row turning into "Added back". Only the summary shows
  removed rows; the list of imports does not. 50 groups show, then **Show 50 more**; a group
  shows 5 rows, then **Show all**. An undone import opens with a `default` Alert
  (`Undo2`) saying when and what the undo removed, and its counts sit muted under "When
  imported" in the past tense.
- **Account question.** Native radio rows, so arrow keys move between them; nothing is
  preselected, and Import stays disabled until every question has an answer. Each row starts
  with its bank's logo as on its Accounts card (imported files: the `Files` leading tile) and a
  small round account-type tile on its corner as on its Accounts row; a new account gets the
  `Plus` leading tile in the same square.
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
  intro says they are almost always in Wisp already and leaving them open loses nothing.
- **Imports list.** On Accounts' Imports tab, and on an account page for the imports that wrote to it: a small heading, then one
  bordered `divide-y` list, newest first, five rows before Show all. A row reads "3 files · 212
  new" over the day, the accounts and any rows still to check (attention tone), with an
  always-visible outline Undo named with its date, after Review while rows are still to check. An
  undone import stays listed, muted, without the buttons. Undo confirms with the destructive variant and says what goes and what stays.
- **Column preview.** The bank a layout is saved under is a `Select` labelled Bank: the owner's own banks
  (`GET /bank-imports/layout-proposals/:proposalId/banks`: their connected or once-connected banks, the
  banks their imported-files accounts record by name and their saved layouts' banks; only names this
  proposal's confirmation accepts, so never Revolut, a name over 60 characters, or, for a file naming no
  account, a bank whose built-in export names none),
  then a separator and **Other**, which reveals a "Bank name" input (60 characters at most). While the
  list loads the picker is disabled and reads "Loading your banks…"; once Looks right is pressed it is not read again; a failed load takes its place as a section `LoadErrorState`
  ("Couldn't load your banks", Try again) and no toast (`quiet`), and Looks right stays disabled until it loads.
  Wisp's guess starts picked when it names a listed bank (ignoring case and spacing), else Other with
  the guess typed in; with no guess nothing is picked and Looks right stays disabled. A name the API
  refuses says why under the control.
- **Imported files.** An imported-files account has the `Files` leading tile and "statement files"
  as its source, and its freshness line runs up to its newest import's last day. It never shows
  consent, sync or reconnecting; its page offers Import a newer file, and Remove account in its Settings card.
