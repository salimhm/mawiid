---
trigger: always_on
---

# Restrictions

- **Strictly use an indentation size of two spaces. Do not use four spaces or any other size**
- **Strictly no comments; code clarity and readability should render comments unnecessary**
- **Strictly the name of a module, database table, agent or tool must be singular, not plural**
- **Strictly use module path aliases instead of relative paths: `@ai`, `@tool`, `@module`, `@lib`, `@db`, and `@<every-single-module-name>`**
- **Strictly interact with the database through services only. Do not perform any queries or operations directly using the table schema**
- Every implemented module must have its own `implementation.md` in its module directory. Keep it updated with each change: explain what is implemented, what remains missing, and how to test the current behavior. Include endpoint contracts, permissions, and known limitations where relevant so the team shares the same understanding. Keep existing planning documents separate from implementation status.

# Naming Conventions

Adherence to strict naming conventions is essential:

- **Files and folders**: kebab-case (e.g., `form-auth`, `user-profile/`)
- **Classes**: PascalCase (e.g., `AgentResponse`, `AgentRequest`)
- **Constants, variables, functions**: snake_case (e.g., `fetch_user_data`, `max_width`)
- **Imports/Exports**: All imports/exports must strictly follow this naming format:
  1. **controller**: `controller_<module_name>`
  2. **dto**: `dto_<module_name>`
  3. **service**: `service_<module_name>`
  5. **tool**: Use `tool_<module_name>_<function_name>` for tools and `toolkit_<module_name>` for toolkits.
  6. **enum**: `enum_<enum_name>`
  7. **database's tables schema**: `table_<table_name>`
  8. **CRUD Naming**: use `find`, `create`, `update`, or `delete`. Do not use variations like 'get', 'add', 'remove', or append table names.
