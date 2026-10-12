---
node: module:shipped-hooks
type: module
title: Shipped hooks
status: active
owner: unassigned
last-verified: {{date}}
{{parent}}---

# Shipped hooks

The hooks and templates Wye ships to every product, read from the install — an upgrade changes them everywhere. To
change one for this product, write a card with the same id on the Hooks page: it replaces the shipped one.

## Hooks

```yaml
- id: hook:import-analyse
  title: An imported document is read by an agent and rewritten into typed blocks, all proposed
  on: module.created
  where: status=imported
  do: task "Import {{title}}" --worker agent --skill skill:import
  once: true
  status: active
- id: hook:test-proposed-note
  title: A proposed test is announced
  on: test.created
  do: notify "A test was proposed: {{title}}"
  once: true
  status: paused
```

## Templates

```yaml
- id: template:test-card
  title: A proposed test card for a node
  body: |
    - test:{{slug}}-test {{title}} — checked #proposed
```
