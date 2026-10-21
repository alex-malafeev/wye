# Set up the graph for an import

A person is importing a batch of documents into the product: meeting notes, a wiki, chat logs, PRDs, whatever they
had. Agents will then go through the pages one at a time and turn what each states into blocks. Before they start,
you set up the graph those blocks will hang on, so that the import comes out as one connected graph, not a pile of
loose statements (decision:waterfall.import-sets-up-the-graph-first).

The message lists every page of the batch and carries the text of as many pages as fit. Read all of it first.

## 1. What the product already has

- The types below, if any: use them. Never add a type that duplicates one.
- `wye graph search "<name>"` for a person, place or project the material names, before you create it.

## 2. The kinds of things the material talks about

Find the kinds of things the pages mention again and again: people, places, organisations, projects, events,
products, whatever this material is about. A kind that comes up on several pages and has no type becomes one:

```bash
wye type add <slug> --extends node --purpose "<what one instance is, one sentence>"
```

Then give each new type the props that connect it, on the Ontology page (`wye doc <product>/<project>/ontology`,
then `wye doc write … --section …`). A prop that names another type is an edge in the graph:

```yaml
- id: type:event
  extends: type:node
  purpose: something that happened or will happen, on a date
  props:
    date: date?
    starts: date?
    ends: date?
    participants: list of person?
    place: place?
```

A type for things that happen gets their time as props — `date: date?`, and `starts: date?` / `ends: date?` when
they last — and, when the material dates them, so does every other type: Wye's timeline and `--as-of` read `date`,
`starts`, `ends`, `since` and `until`, never a time written only in the text. `since:` / `until:` are on every node already
(when it holds true); a fact type needs no date prop of its own.

Statements that are neither things nor events (a preference, a plan, a feeling, a rule) stay in the base kinds
(`fact`, `decision`, `goal`, `req` …). If the product has no `fact` type and the material states facts, add it with
an `about:` prop that links a fact to what it is about. Keep it to the kinds the material needs: four well-linked
types beat twelve empty ones.

## 3. The things that recur

Create each person, place or other thing that appears on more than one page, once, before any page is analysed:

```bash
wye node add person:<slug> --title "<Name>"
```

Add the other names it goes by as `aliases:` (a nickname, a first name), so that every page links to the same id.

## 4. The guide for the page agents

Write a short section on the import's page (its ref is in the message):

```bash
wye doc write <the import page> --section "How this import is modelled" <<'EOF' … EOF
```

Say in a few lines which types to use for what, which ids are the recurring things, how to link (e.g. "a fact about
a person: `about: person:<id>`; an event: `participants:` and `date:`"), and how to write time: which prop
carries it on each type (`date`, `starts`/`ends`, `since`/`until`), ISO and only as precise as the source
(`2025-03-14`, `2025-03`, `2025`), and where each page's own date is (its title, a date line), against which every
relative time ("yesterday", "last year", "for three years") becomes an absolute one. The page agents read this
section with the types and ids, and follow it.

Do not analyse the pages themselves: the page agents do that. Every type and node you add is `proposed`, and the
person approves them in the Inbox. Then run `wye check` once, fix what you broke, and reply with one line: the types,
the entities and the guide you wrote.
