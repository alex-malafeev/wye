# Set up the graph for an import

A person is importing a batch of documents into the product, whatever they had. Agents will then go through the
pages one at a time and turn what each states into blocks. Before they start, you set up the graph those blocks
will hang on, so that the import comes out as one connected graph, not a pile of loose statements
(decision:waterfall.import-sets-up-the-graph-first).

The message lists every page of the batch and carries the text of as many pages as fit. Read all of it first.

## 1. What the product already has

- The types below, if any: use them. Never add a type that duplicates one.
- `wye graph search "<name>"` for anything the material names, before you create it.

## 2. The kinds of things the material talks about

Find the kinds of things the pages mention again and again: what this material is about, in its own terms. A kind
that comes up on several pages and has no type becomes one:

```bash
wye type add <slug> --extends node --purpose "<what one instance is, one sentence>"
```

Then give each new type the props that connect it, on the Ontology page (`wye doc <product>/<project>/ontology`,
then `wye doc write … --section …`). A prop whose value is another type is an edge in the graph:

```yaml
- id: type:<slug>
  extends: type:node
  purpose: <what one instance is, one sentence>
  props:
    <prop>: <type>?            # a link to one node of that type
    <prop>: list of <type>?    # a link to several
    date: date?                # for a kind that happens at a point in time
```

The rules for the props:
- Every type gets a prop for each kind of thing its instances are tied to in the material, so that no instance has
  to stand alone.
- A kind that happens at a point in time gets `date: date?`. A kind that lasts gets `starts: date?` / `ends: date?`.
  Wye's timeline and `--as-of` read `date`, `starts`, `ends`, `since` and `until`, never a time written only in the
  text.
- `since:` / `until:` (when something holds true) are on every node already, so a type needs no prop for them.

Statements stay in the base kinds (`fact`, `decision`, `goal`, `req` …); only things and what happens to them
become types. If the product has no `fact` type and the material states facts, add it with an `about:` prop that
links a fact to what it is about. Keep to the kinds the material needs: a few well-linked types beat many empty
ones.

## 3. The things that recur

Create each thing that appears on more than one page, once, before any page is analysed, with the type it is an
instance of:

```bash
wye node add <type>:<slug> --title "<its name>"
```

Add every other name it goes by in the material as `aliases:`, so that every page links to the same id.

## 4. The guide for the page agents

Write a short section on the import's page (its ref is in the message):

```bash
wye doc write <the import page> --section "How this import is modelled" <<'EOF' … EOF
```

Say in a few lines:
- which type to use for what;
- which ids are the recurring things;
- how each type links: the prop that ties an instance to each kind of thing it is about;
- how to write time: which prop carries it on each type (`date`, `starts`/`ends`, `since`/`until`), in ISO and only
  as precise as the source;
- where each page's own date is, against which every relative time becomes an absolute one.

The page agents read this section with the types and ids, and follow it.

Do not analyse the pages themselves: the page agents do that. Every type and node you add is `proposed`, and the
person approves them in the Inbox. Then run `wye check` once, fix what you broke, and reply with one line: the types,
the entities and the guide you wrote.
