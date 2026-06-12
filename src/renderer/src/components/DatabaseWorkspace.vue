<template>
  <section
    class="database-workspace"
    :class="{
      'db-ai-pane-visible': dbAiPaneOpen,
      'db-ai-pane-resizing': dbAiPaneResizing
    }"
    :style="databaseWorkspaceStyle"
  >
    <aside
      class="db-sidebar"
      :class="{ collapsed: sidebarCollapsed }"
    >
      <template v-if="!sidebarCollapsed">
        <header class="db-sidebar-header">
          <strong>Database</strong>
          <div class="db-sidebar-actions">
            <button
              type="button"
              title="Refresh connected"
              @click="refreshConnected"
            >
              <RefreshCw />
            </button>
            <button
              ref="addButtonRef"
              type="button"
              title="Add"
              @click.stop="toggleAddMenu"
            >
              <Plus />
            </button>
            <button
              type="button"
              title="Collapse"
              @click="sidebarCollapsed = true"
            >
              <PanelLeftClose />
            </button>
          </div>
        </header>

        <div class="db-search">
          <Search />
          <input
            ref="searchInputRef"
            v-model="keyword"
            placeholder="Search"
            @keydown.esc.prevent="clearDatabaseSearch"
          />
          <button
            v-if="keyword"
            class="db-search-clear"
            type="button"
            title="Clear search"
            @click="clearDatabaseSearch"
          >
            <X />
          </button>
        </div>

        <nav class="db-tree">
          <ul>
            <li
              v-for="group in visibleGroupNodes"
              :key="group.id"
            >
              <div
                class="db-tree-row group"
                :class="{ selected: selectedNodeId === group.id }"
                :style="{ paddingLeft: `${6 + group.depth * 14}px` }"
                @click="selectNode(group.id)"
                @contextmenu.prevent="openContextMenu($event, { type: 'group', groupId: group.id, label: group.name })"
              >
                <button
                  type="button"
                  @click.stop="toggleGroup(group.id)"
                >
                  <ChevronDown v-if="expandedGroups.includes(group.id)" />
                  <ChevronRight v-else />
                </button>
                <FolderOpen v-if="expandedGroups.includes(group.id)" />
                <Folder v-else />
                <input
                  v-if="editingGroupId === group.id"
                  v-model="editingGroupName"
                  class="db-tree-edit"
                  @click.stop
                  @keydown.enter.prevent="commitGroupRename"
                  @keydown.esc.prevent="cancelGroupRename"
                  @blur="commitGroupRename"
                />
                <span v-else>{{ group.name }}</span>
              </div>

              <ul
                v-if="expandedGroups.includes(group.id)"
                class="db-tree-children"
                :style="{ paddingLeft: `${12 + group.depth * 14}px` }"
              >
                <li
                  v-for="connection in connectionsByGroup(group.id)"
                  :key="connection.id"
                >
                  <div
                    class="db-tree-row connection"
                    :class="{ selected: selectedNodeId === connection.id }"
                    @click="selectNode(connection.id)"
                    @contextmenu.prevent="openContextMenu($event, { type: 'connection', connectionId: connection.id, label: connection.name })"
                  >
                    <button
                      type="button"
                      @click.stop="toggleConnection(connection.id)"
                    >
                      <ChevronDown v-if="expandedConnections.includes(connection.id)" />
                      <ChevronRight v-else />
                    </button>
                    <span
                      class="db-engine-dot"
                      :style="{ background: engineAccent(connection.dbType) }"
                    />
                    <span>{{ connection.name }}</span>
                    <span
                      class="db-status-dot"
                      :class="connection.status"
                    />
                    <button
                      class="db-tree-connect"
                      type="button"
                      :title="connection.status === 'connected' ? 'Disconnect' : 'Connect'"
                      @click.stop="toggleConnectionStatus(connection.id)"
                    >
                      <Unplug v-if="connection.status === 'connected'" />
                      <Zap v-else />
                    </button>
                  </div>

                  <ul
                    v-if="expandedConnections.includes(connection.id)"
                    class="db-tree-children deep"
                  >
                    <li
                      v-for="catalog in connection.catalogs"
                      :key="`${connection.id}:${catalog.name}`"
                    >
                      <div
                        class="db-tree-row database"
                        :class="{ selected: selectedNodeId === `${connection.id}:${catalog.name}` }"
                        @click="selectNode(`${connection.id}:${catalog.name}`)"
                      >
                        <button
                          type="button"
                          @click.stop="toggleCatalog(connection.id, catalog.name)"
                        >
                          <ChevronDown v-if="isCatalogExpanded(connection.id, catalog.name)" />
                          <ChevronRight v-else />
                        </button>
                        <Database />
                        <span>{{ catalog.name }}</span>
                      </div>

                      <ul
                        v-if="isCatalogExpanded(connection.id, catalog.name)"
                        class="db-tree-children deep"
                      >
                        <template v-if="catalog.schemas">
                          <li
                            v-for="schema in catalog.schemas"
                            :key="`${connection.id}:${catalog.name}:${schema.name}`"
                          >
                            <div
                              class="db-tree-row schema"
                              :class="{ selected: selectedNodeId === `${connection.id}:${catalog.name}:${schema.name}` }"
                              @click="selectNode(`${connection.id}:${catalog.name}:${schema.name}`)"
                            >
                              <button
                                type="button"
                                @click.stop="toggleSchema(connection.id, catalog.name, schema.name)"
                              >
                                <ChevronDown v-if="isSchemaExpanded(connection.id, catalog.name, schema.name)" />
                                <ChevronRight v-else />
                              </button>
                              <Network />
                              <span>{{ schema.name }}</span>
                            </div>

                            <ul
                              v-if="isSchemaExpanded(connection.id, catalog.name, schema.name)"
                              class="db-tree-children deep"
                            >
                              <li
                                v-for="folder in schemaObjectFolders(schema)"
                                :key="schemaObjectFolderKey(connection.id, catalog.name, schema.name, folder.kind)"
                              >
                                <div
                                  class="db-tree-row folder"
                                  :class="{ selected: selectedNodeId === schemaObjectFolderKey(connection.id, catalog.name, schema.name, folder.kind) }"
                                  @click="selectNode(schemaObjectFolderKey(connection.id, catalog.name, schema.name, folder.kind))"
                                >
                                  <button
                                    type="button"
                                    @click.stop="toggleSchemaObjectFolder(connection.id, catalog.name, schema.name, folder.kind)"
                                  >
                                    <ChevronDown v-if="isSchemaObjectFolderExpanded(connection.id, catalog.name, schema.name, folder.kind)" />
                                    <ChevronRight v-else />
                                  </button>
                                  <FolderOpen v-if="isSchemaObjectFolderExpanded(connection.id, catalog.name, schema.name, folder.kind)" />
                                  <Folder v-else />
                                  <span>{{ folder.kind }}</span>
                                  <small>{{ folder.count }}</small>
                                </div>
                                <ul
                                  v-if="isSchemaObjectFolderExpanded(connection.id, catalog.name, schema.name, folder.kind)"
                                  class="db-tree-children deep"
                                >
                                  <li
                                    v-for="table in folder.tables"
                                    :key="table.id"
                                  >
                                    <div
                                      class="db-tree-row table"
                                      :class="{ selected: selectedNodeId === table.id }"
                                      @click="selectNode(table.id)"
                                      @dblclick="openTable(connection.id, catalog.name, table, schema.name)"
                                      @contextmenu.prevent="
                                        openContextMenu($event, {
                                          type: 'table',
                                          connectionId: connection.id,
                                          catalogName: catalog.name,
                                          schemaName: schema.name,
                                          tableId: table.id,
                                          label: table.name
                                        })
                                      "
                                    >
                                      <button
                                        type="button"
                                        @click.stop="toggleTable(table.id)"
                                      >
                                        <ChevronDown v-if="isTableExpanded(table.id)" />
                                        <ChevronRight v-else />
                                      </button>
                                      <Table2 />
                                      <span>{{ table.name }}</span>
                                    </div>
                                    <ul
                                      v-if="isTableExpanded(table.id)"
                                      class="db-tree-children deep"
                                    >
                                      <li
                                        v-for="column in table.columns"
                                        :key="`${table.id}:${column.name}`"
                                      >
                                        <div
                                          class="db-tree-row column"
                                          :class="{ selected: selectedNodeId === columnNodeId(table.id, column.name) }"
                                          @click="selectColumnNode(table, column)"
                                        >
                                          <span class="db-tree-spacer" />
                                          <Columns3 />
                                          <span>{{ column.name }}</span>
                                          <small v-if="column.key">{{ column.key }}</small>
                                        </div>
                                      </li>
                                    </ul>
                                  </li>
                                  <li
                                    v-for="routine in folder.routines"
                                    :key="`${schemaObjectFolderKey(connection.id, catalog.name, schema.name, folder.kind)}:${routine}`"
                                  >
                                    <div
                                      class="db-tree-row column"
                                      :class="{ selected: selectedNodeId === schemaRoutineNodeId(connection.id, catalog.name, schema.name, folder.kind, routine) }"
                                      @click="selectNode(schemaRoutineNodeId(connection.id, catalog.name, schema.name, folder.kind, routine))"
                                    >
                                      <span class="db-tree-spacer" />
                                      <Columns3 />
                                      <span>{{ routine }}</span>
                                    </div>
                                  </li>
                                </ul>
                              </li>
                            </ul>
                          </li>
                        </template>

                        <li v-if="catalog.tables">
                          <div class="db-tree-row folder">
                            <span class="db-tree-spacer" />
                            <FolderOpen />
                            <span>tables</span>
                          </div>
                          <ul class="db-tree-children deep">
                            <li
                              v-for="table in catalog.tables"
                              :key="table.id"
                            >
                              <div
                                class="db-tree-row table"
                                :class="{ selected: selectedNodeId === table.id }"
                                @click="selectNode(table.id)"
                                @dblclick="openTable(connection.id, catalog.name, table)"
                                @contextmenu.prevent="
                                  openContextMenu($event, {
                                    type: 'table',
                                    connectionId: connection.id,
                                    catalogName: catalog.name,
                                    tableId: table.id,
                                    label: table.name
                                  })
                                "
                              >
                                <button
                                  type="button"
                                  @click.stop="toggleTable(table.id)"
                                >
                                  <ChevronDown v-if="isTableExpanded(table.id)" />
                                  <ChevronRight v-else />
                                </button>
                                <Table2 />
                                <span>{{ table.name }}</span>
                              </div>
                              <ul
                                v-if="isTableExpanded(table.id)"
                                class="db-tree-children deep"
                              >
                                <li
                                  v-for="column in table.columns"
                                  :key="`${table.id}:${column.name}`"
                                >
                                  <div
                                    class="db-tree-row column"
                                    :class="{ selected: selectedNodeId === columnNodeId(table.id, column.name) }"
                                    @click="selectColumnNode(table, column)"
                                  >
                                    <span class="db-tree-spacer" />
                                    <Columns3 />
                                    <span>{{ column.name }}</span>
                                    <small v-if="column.key">{{ column.key }}</small>
                                  </div>
                                </li>
                              </ul>
                            </li>
                          </ul>
                        </li>
                      </ul>
                    </li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </nav>
      </template>

      <button
        v-else
        class="db-sidebar-expand"
        type="button"
        title="Expand"
        @click="sidebarCollapsed = false"
      >
        <PanelLeftOpen />
      </button>
    </aside>

    <main class="db-main">
      <div class="db-workspace-tabs">
        <div class="db-workspace-tab-scroll">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :ref="(el) => registerWorkspaceTabRef(tab.id, el)"
            class="db-workspace-tab"
            :class="{ active: activeTabId === tab.id }"
            type="button"
            @click="activeTabId = tab.id"
          >
            <LayoutDashboard v-if="tab.kind === 'overview'" />
            <Table2 v-else-if="tab.kind === 'data'" />
            <SquareTerminal v-else />
            <span>{{ tab.title }}</span>
            <button
              v-if="tab.kind !== 'overview'"
              type="button"
              title="Close"
              @click.stop="closeTab(tab.id)"
            >
              <X />
            </button>
          </button>
          <button
            class="db-workspace-add-tab"
            type="button"
            title="New SQL"
            @click="openSqlConsole()"
          >
            <Plus />
          </button>
        </div>
        <div class="db-tab-overflow">
          <button
            type="button"
            class="db-ai-pane-toggle"
            :class="{ active: dbAiPaneOpen }"
            title="Toggle DB AI Pane"
            :disabled="!canToggleDbAiPane"
            @click="toggleDbAiPane"
          >
            <BrainCircuit />
          </button>
          <button
            type="button"
            title="Tabs"
            @click="overflowOpen = !overflowOpen"
          >
            <MoreHorizontal />
          </button>
          <div
            v-if="overflowOpen"
            class="db-tab-menu"
          >
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              @click="selectOverflowTab(tab.id)"
            >
              {{ tab.title }}
            </button>
          </div>
        </div>
      </div>

      <section
        v-if="activeTab?.kind === 'overview'"
        class="db-overview"
      >
        <div class="db-overview-hero">
          <div class="db-overview-header">
            <span class="db-overview-eyebrow">Overview</span>
            <h2>Overview</h2>
            <p>Manage connections, browse schema trees, open table data, and run SQL consoles from the Database workspace.</p>
          </div>
          <div class="db-overview-tips">
            <button
              type="button"
              @click="toggleAddMenu"
            >
              <strong>+</strong>
              <span>Create connection</span>
            </button>
            <button
              type="button"
              @click="focusDatabaseSearch"
            >
              <strong>/</strong>
              <span>Explore schemas</span>
            </button>
            <button
              type="button"
              @click="openSqlConsole()"
            >
              <strong>SQL</strong>
              <span>Query console</span>
            </button>
          </div>
        </div>
        <div class="db-overview-panel">
          <header>
            <div>
              <strong>New Connection</strong>
              <p>Choose a database engine to start a connection profile.</p>
            </div>
            <em title="Database engines">{{ databaseEngines.length }}</em>
          </header>
          <div class="db-engine-grid">
            <button
              v-for="engine in databaseEngines"
              :key="`${engine.name}-${engine.code}`"
              type="button"
              :title="`New ${engine.name} connection`"
              @click="openOverviewEngine(engine)"
            >
              <span
                class="db-engine-dot"
                :style="{ background: engine.accent }"
              />
              <span class="db-engine-name">{{ engine.name }}</span>
            </button>
          </div>
        </div>
      </section>

      <section
        v-else-if="activeTab?.kind === 'sql'"
        class="db-sql-workspace"
      >
        <div class="db-sql-toolbar">
          <button
            type="button"
            class="db-sql-toolbar-btn db-sql-toolbar-run"
            title="Run all"
            :disabled="!activeSqlCanRun"
            @click="runSql('all')"
          >
            <Play />
          </button>
          <button
            type="button"
            class="db-sql-toolbar-btn db-sql-toolbar-run-current"
            title="Run current statement"
            :disabled="!activeSqlCanRun"
            @click="runSql('current')"
          >
            <CornerDownRight />
          </button>
          <button
            type="button"
            class="db-sql-toolbar-btn db-sql-toolbar-explain"
            title="Explain"
            :disabled="!activeSqlCanRun"
            @click="runSql('explain')"
          >
            <Lightbulb />
          </button>
          <span class="db-toolbar-divider" />
          <button
            type="button"
            class="db-sql-toolbar-btn db-sql-toolbar-save"
            :disabled="!activeSqlTab || activeSqlSaving"
            :title="activeSqlSaveTitle"
            @click="saveActiveSql(false)"
          >
            <Save />
          </button>
          <button
            type="button"
            class="db-sql-toolbar-btn db-sql-toolbar-save-as"
            :disabled="!activeSqlTab || activeSqlSaving"
            title="Save As"
            @click="saveActiveSql(true)"
          >
            <SaveAll />
          </button>
          <button
            type="button"
            class="db-sql-toolbar-btn db-sql-toolbar-format"
            :disabled="!activeTab.connectionId"
            title="Format"
            @click="formatSql"
          >
            <AlignLeft />
          </button>
          <span class="db-toolbar-divider" />
          <span class="db-ai-toolbar">
            <button
              type="button"
              title="AI Explain SQL"
              :disabled="!activeSqlHasText"
              @click="openDbAiFromToolbar('explain')"
            >
              <BrainCircuit />
            </button>
            <button
              type="button"
              title="AI Optimize SQL"
              :disabled="!activeSqlHasText"
              @click="openDbAiFromToolbar('optimize')"
            >
              <WandSparkles />
            </button>
            <button
              type="button"
              title="AI Convert SQL"
              :disabled="!activeSqlHasText"
              @click="openDbAiFromToolbar('convert')"
            >
              <Languages />
            </button>
            <button
              type="button"
              title="AI Complete SQL"
              :disabled="!activeSqlTab"
              @click="openDbAiFromToolbar('complete')"
            >
              <TextCursorInput />
            </button>
            <button
              type="button"
              title="AI NL2SQL"
              :disabled="!activeSqlTab"
              @click="openDbAiFromToolbar('nl2sql')"
            >
              <FileSearch />
            </button>
          </span>
          <span class="db-toolbar-spacer" />
          <select
            class="db-picker db-picker--connection"
            :value="activeTab.connectionId"
            :disabled="connections.length === 0"
            @change="updateSqlTabConnection"
          >
            <option
              value=""
              disabled
            >
              Connection
            </option>
            <option
              v-for="connection in connections"
              :key="connection.id"
              :value="connection.id"
            >
              {{ connection.name }}{{ connection.status === 'testing' ? ' [connecting...]' : '' }}
            </option>
          </select>
          <select
            class="db-picker db-picker--database"
            :value="activeTab.catalogName"
            :disabled="currentSqlCatalogs.length === 0"
            @change="updateSqlTabCatalog"
          >
            <option
              value=""
              disabled
            >
              Database
            </option>
            <option
              v-for="catalog in currentSqlCatalogs"
              :key="catalog.name"
              :value="catalog.name"
            >
              {{ catalog.name }}
            </option>
          </select>
          <select
            v-if="activeSqlRequiresSchema"
            class="db-picker db-picker--schema"
            :value="activeTab.schemaName"
            :disabled="currentSqlSchemas.length === 0"
            @change="updateSqlTabSchema"
          >
            <option
              value=""
              disabled
            >
              Schema
            </option>
            <option
              v-for="schema in currentSqlSchemas"
              :key="schema.name"
              :value="schema.name"
            >
              {{ schema.name }}
            </option>
          </select>
        </div>
        <div
          class="db-sql-panes"
          :class="{ resizing: sqlPaneResizing }"
          :style="sqlPaneStyle"
        >
          <div
            class="db-sql-editor-shell"
            @click="focusSqlEditor"
          >
            <div
              class="db-sql-editor-gutter"
              :style="{ transform: `translateY(-${sqlEditorScrollTop}px)` }"
              aria-hidden="true"
            >
              <span
                v-for="line in activeSqlEditorLines"
                :key="line"
                :class="{ active: line === sqlEditorActiveLine }"
              >
                {{ line }}
              </span>
            </div>
            <div class="db-sql-editor-surface">
              <div
                class="db-sql-editor-active-line"
                :style="{ transform: `translateY(${sqlEditorActiveLineTop}px)` }"
                aria-hidden="true"
              />
              <DatabaseSqlEditor
                ref="sqlEditorRef"
                v-model="activeTab.sql"
                @metrics="syncSqlEditorState"
                @run="runSqlFromShortcut"
                @open-find="openSqlFind"
              />
            </div>
            <div
              v-if="sqlFindOpen"
              class="db-sql-find-panel"
              @click.stop
            >
              <div class="db-sql-find-row">
                <Search />
                <input
                  ref="sqlFindInputRef"
                  v-model="sqlFindQuery"
                  aria-label="Find in SQL"
                  placeholder="Find"
                  @keydown="(event) => handleSqlFindKeydown(event, 'query')"
                />
                <span class="db-sql-find-count">{{ sqlFindSummary }}</span>
                <button
                  type="button"
                  title="Previous match"
                  :disabled="sqlFindMatches.length === 0"
                  @click="goToSqlFindMatch(-1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Next match"
                  :disabled="sqlFindMatches.length === 0"
                  @click="goToSqlFindMatch(1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  title="Toggle replace"
                  :class="{ active: sqlFindReplaceOpen }"
                  @click="toggleSqlFindReplace"
                >
                  Replace
                </button>
                <button
                  type="button"
                  title="Match case"
                  :class="{ active: sqlFindCaseSensitive }"
                  @click="sqlFindCaseSensitive = !sqlFindCaseSensitive"
                >
                  Aa
                </button>
                <button
                  type="button"
                  title="Close find"
                  @click="closeSqlFind(true)"
                >
                  <X />
                </button>
              </div>
              <div
                v-if="sqlFindReplaceOpen"
                class="db-sql-find-row replace"
              >
                <span />
                <input
                  ref="sqlReplaceInputRef"
                  v-model="sqlFindReplace"
                  aria-label="Replace in SQL"
                  placeholder="Replace"
                  @keydown="(event) => handleSqlFindKeydown(event, 'replace')"
                />
                <button
                  type="button"
                  title="Replace current"
                  :disabled="sqlFindMatches.length === 0"
                  @click="replaceCurrentSqlFindMatch"
                >
                  Replace
                </button>
                <button
                  type="button"
                  title="Replace all"
                  :disabled="sqlFindMatches.length === 0"
                  @click="replaceAllSqlFindMatches"
                >
                  All
                </button>
              </div>
            </div>
            <footer class="db-sql-editor-footer">
              <span
                v-if="activeSqlTab"
                class="db-sql-save-state"
                :class="{ dirty: activeSqlIsDirty, saving: activeSqlSaving, error: Boolean(activeSqlTab.saveError) }"
                :title="activeSqlTab.filePath || activeSqlTab.saveError || undefined"
              >
                {{ activeSqlSaveStateText }}
              </span>
              <span>{{ activeSqlEditorLineCount }} lines</span>
              <span>Ln {{ sqlEditorActiveLine }}, Col {{ sqlEditorActiveColumn }}</span>
              <span v-if="sqlEditorSelectionSize">{{ sqlEditorSelectionSize }} selected</span>
            </footer>
          </div>
          <button
            type="button"
            class="db-sql-splitter"
            title="Resize SQL editor and results"
            role="separator"
            aria-orientation="horizontal"
            :aria-valuemin="SQL_PANE_MIN_PERCENT"
            :aria-valuemax="SQL_PANE_MAX_PERCENT"
            :aria-valuenow="Math.round(sqlPaneEditorPercent)"
            @pointerdown="startSqlPaneResize"
            @dblclick="resetSqlPaneSplit"
          >
            <span aria-hidden="true" />
          </button>
          <div class="db-sql-results">
            <div
              class="db-result-tabs"
              role="tablist"
            >
              <div
                role="tab"
                tabindex="0"
                :aria-selected="activeTab.activeResultTabId === 'overview'"
                :class="{ active: activeTab.activeResultTabId === 'overview' }"
                @click="activeTab.activeResultTabId = 'overview'"
                @keydown.enter.prevent="activeTab.activeResultTabId = 'overview'"
                @keydown.space.prevent="activeTab.activeResultTabId = 'overview'"
              >
                Overview
              </div>
              <div
                v-for="result in activeTab.resultTabs"
                :key="result.id"
                role="tab"
                tabindex="0"
                :aria-selected="activeTab.activeResultTabId === result.id"
                :title="result.title"
                :class="{ active: activeTab.activeResultTabId === result.id }"
                @click="activeTab.activeResultTabId = result.id"
                @keydown.enter.prevent="activeTab.activeResultTabId = result.id"
                @keydown.space.prevent="activeTab.activeResultTabId = result.id"
              >
                <span
                  class="db-result-dot"
                  :class="result.status"
                />
                <span
                  class="db-result-tab-title"
                >
                  {{ result.title }}
                </span>
                <button
                  type="button"
                  class="db-result-tab-close"
                  aria-label="Close result tab"
                  @click.stop="closeResultTab(result.id)"
                >
                  <X />
                </button>
              </div>
            </div>

            <div
              v-if="activeTab.activeResultTabId === 'overview'"
              class="db-sql-overview"
            >
              <p v-if="!activeTab.history.length">Run SQL to create a result tab.</p>
              <table v-else>
                <thead>
                  <tr>
                    <th>SQL</th>
                    <th>Message</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="history in activeTab.history"
                    :key="history.id"
                    :class="{ closed: isSqlHistoryClosed(history), error: history.status === 'error' }"
                    :data-execution-id="history.id"
                    :title="history.createdAt"
                    @click="openSqlHistoryResult(history)"
                  >
                    <td>
                      <span
                        class="db-result-dot"
                        :class="history.status"
                      />
                      <code>{{ history.sql }}</code>
                    </td>
                    <td>
                      <strong :class="history.status">{{ history.message }}</strong>
                    </td>
                    <td>{{ history.durationMs }}ms</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <template v-else-if="activeSqlResult">
              <div
                v-if="activeSqlResult.status === 'running'"
                class="db-result-running"
              >
                <span
                  class="db-result-dot running"
                  aria-hidden="true"
                />
                <div>
                  <strong>Running query</strong>
                  <small>{{ activeSqlResult.title }}</small>
                  <p>{{ activeSqlResult.sql }}</p>
                </div>
              </div>
              <div
                v-else-if="activeSqlResult.status === 'error'"
                class="db-result-error"
              >
                <span class="db-result-error-text">{{ activeSqlResult.error }}</span>
                <span
                  v-if="sqlDiagnose.success && sqlDiagnose.resultId === activeSqlResult.id"
                  class="db-result-diagnose-success"
                >
                  Diagnosed and replaced editor SQL
                </span>
                <span
                  v-if="sqlDiagnose.error && sqlDiagnose.resultId === activeSqlResult.id"
                  class="db-result-diagnose-error"
                >
                  {{ sqlDiagnose.error }}
                </span>
                <button
                  type="button"
                  class="db-result-diagnose-btn"
                  :class="{ loading: sqlDiagnose.running && sqlDiagnose.resultId === activeSqlResult.id }"
                  :disabled="sqlDiagnose.running && sqlDiagnose.resultId === activeSqlResult.id"
                  @click="diagnoseSqlError(activeSqlResult)"
                >
                  <span
                    v-if="sqlDiagnose.running && sqlDiagnose.resultId === activeSqlResult.id"
                    class="db-result-diagnose-spinner"
                    aria-hidden="true"
                  />
                  <span v-else>Diagnose</span>
                </button>
              </div>
              <template v-else>
                <DataGridToolbar
                  :page="activeSqlResultViewState.page"
                  :page-size="activeSqlResultViewState.pageSize"
                  :total="filteredSqlRows.length"
                  :hide-refresh="true"
                  :can-export="activeSqlResult.status === 'ok' && pagedSqlRows.length > 0"
                  export-title="Export current SQL result page"
                  :can-chart="activeSqlResult.status === 'ok' && pagedSqlRows.length > 0"
                  chart-title="Chart current SQL result page"
                  :can-comment="activeSqlResult.status === 'ok'"
                  comment-title="Comment current SQL result"
                  @goto-page="(page) => updateSqlResultPage(page)"
                  @goto-last-page="gotoLastSqlResultPage"
                  @change-page-size="(size) => updateSqlResultPageSize(size)"
                  @export="exportActiveSqlResultPage"
                  @chart="openActiveSqlResultChart"
                  @comment="openActiveSqlResultComment"
                />
                <ResultGrid
                  class="db-sql-result-grid"
                  :columns="activeSqlResult.columns"
                  :rows="pagedSqlRows"
                  :source-rows="activeSqlResult.rows"
                  :sort="activeSqlResultViewState.sort"
                  :filters="activeSqlResultViewState.filters"
                  :start-row-index="(activeSqlResultViewState.page - 1) * activeSqlResultViewState.pageSize + 1"
                  @sort="(column) => cycleSqlSort(column)"
                  @filter="(column, filter) => applySqlFilter(column, filter)"
                />
              </template>
              <DataStatusBar
                :status="activeSqlResult.status"
                :error="activeSqlResult.error || undefined"
                :message="activeSqlResult.message"
                :duration-ms="activeSqlResult.durationMs"
                :row-count="activeSqlResult.rowCount"
              />
            </template>
          </div>
        </div>
      </section>

      <section
        v-else-if="activeDataTab"
        class="db-data-workspace"
      >
        <DataGridToolbar
          :page="activeDataTab.page"
          :page-size="activeDataTab.pageSize"
          :total="activeDataTab.total"
          :can-edit="canEditDataTab(activeDataTab)"
          :has-selection="!!activeDataTab.selectedRowKey"
          :can-undo="activeDataTab.undoStack.length > 0"
          :is-dirty="isDataTabDirty(activeDataTab)"
          :edit-disabled-reason="dataEditDisabledReason(activeDataTab)"
          :can-export="!activeDataTab.loading && !activeDataTab.error && pagedDataRows.length > 0"
          export-title="Export current table page"
          :can-chart="!activeDataTab.loading && !activeDataTab.error && pagedDataRows.length > 0"
          chart-title="Chart current table page"
          :can-comment="!activeDataTab.loading && !activeDataTab.error"
          comment-title="Comment current table page"
          @goto-page="(page) => updateDataPage(page)"
          @goto-last-page="gotoLastDataPage"
          @change-page-size="(size) => updateDataPageSize(size)"
          @refresh-total="refreshDataTotal"
          @refresh="refreshDataTab"
          @add-row="addDataRow"
          @delete-row="deleteSelectedDataRow"
          @undo="undoDataChanges"
          @save="saveDataChanges"
          @export="exportActiveDataPage"
          @chart="openActiveDataChart"
          @comment="openActiveDataComment"
        />
        <div class="db-where-bar">
          <span class="db-where-table"><Table2 /> {{ activeDataTab.tableName }}</span>
          <i />
          <input
            v-model="activeDataTab.whereDraft"
            aria-label="WHERE condition"
            :class="{ pending: activeDataWherePending }"
            placeholder="Input WHERE condition"
            @keydown.enter.prevent="applyWhere"
          />
          <button
            type="button"
            title="Apply filter"
            :class="{ pending: activeDataWherePending }"
            @click="applyWhere"
          >
            <Play />
          </button>
        </div>
        <section
          v-if="activeDataEditSummary?.isDirty"
          class="db-edit-summary"
          :class="{ error: !!activeDataEditSummary.error, warning: !!activeDataEditSummary.warning && !activeDataEditSummary.error }"
        >
          <div class="db-edit-summary-counts">
            <span><strong>{{ activeDataEditSummary.newRows }}</strong> New</span>
            <span><strong>{{ activeDataEditSummary.updatedRows }}</strong> Updated</span>
            <span><strong>{{ activeDataEditSummary.deletedRows }}</strong> Deleted</span>
            <span><strong>{{ activeDataEditSummary.undoDepth }}</strong> Undo</span>
            <span><strong>{{ activeDataEditSummary.statementCount }}</strong> SQL</span>
          </div>
          <p
            v-if="activeDataEditSummary.error || activeDataEditSummary.warning || activeDataTab.saveError"
            class="db-edit-summary-message"
          >
            {{ activeDataTab.saveError || activeDataEditSummary.error || activeDataEditSummary.warning }}
          </p>
          <pre>{{ activeDataEditSummary.preview || 'No SQL statement will be generated until a new row contains at least one value.' }}</pre>
          <div class="db-edit-summary-actions">
            <button
              type="button"
              :disabled="!activeDataEditSummary.preview || activeDataTab.saving"
              @click="copyDataMutationPreview"
            >
              Copy Preview
            </button>
            <button
              type="button"
              :disabled="activeDataTab.saving"
              @click="discardDataChanges"
            >
              Discard All
            </button>
          </div>
        </section>
        <div class="db-data-grid-shell">
          <div
            v-if="activeDataTab.loading"
            class="db-data-loading"
          >
            Loading table data
          </div>
          <div
            v-else-if="activeDataTab.error"
            class="db-result-error"
          >
            <span>{{ activeDataTab.error }}</span>
          </div>
          <ResultGrid
            v-else
            :columns="activeDataTab.columns"
            :rows="pagedDataRows"
            :source-rows="activeDataTab.sourceRows"
            :sort="activeDataTab.sort"
            :filters="activeDataTab.filters"
            :start-row-index="(activeDataTab.page - 1) * activeDataTab.pageSize + 1"
            :selected-key="activeDataTab.selectedRowKey || undefined"
            :primary-key="activeDataTab.primaryKey"
            :new-rows="activeDataTab.dirtyState.newRows"
            :deleted-row-keys="activeDataTab.dirtyState.deletedRowKeys"
            :updated-cells="activeDataTab.dirtyState.updatedCells"
            :editable="canEditDataTab(activeDataTab)"
            @sort="(column) => cycleDataSort(column)"
            @filter="(column, filter) => applyDataFilter(column, filter)"
            @select-row="setActiveDataSelectedRow"
            @cell-edit="updateDataCell"
            @new-row-cell-edit="updateNewDataRowCell"
          />
        </div>
        <DataStatusBar
          :error="activeDataTab.error || undefined"
          :duration-ms="activeDataTab.durationMs"
          :row-count="activeDataTab.rowCount"
        />
      </section>
    </main>

    <aside
      v-if="dbAiPaneOpen"
      class="db-ai-pane"
    >
      <div
        class="db-ai-pane-resizer"
        role="separator"
        aria-orientation="vertical"
        :aria-valuemin="DB_AI_PANE_MIN_WIDTH"
        :aria-valuemax="DB_AI_PANE_MAX_WIDTH"
        :aria-valuenow="dbAiPaneWidth"
        title="Resize DB AI pane"
        @pointerdown="startDbAiPaneResize"
        @dblclick="resetDbAiPaneWidth"
      />
      <div class="db-ai-pane-shell">
        <header class="db-ai-pane-header">
          <div class="db-ai-pane-title">
            <BrainCircuit />
            <div>
              <strong>DB AI</strong>
              <span>Database workspace</span>
            </div>
          </div>
          <button
            type="button"
            title="Close DB AI Pane"
            @click="closeDbAiPane"
          >
            <X />
          </button>
        </header>

        <section class="db-ai-pane-context-card">
          <div class="db-ai-pane-context-head">
            <span>{{ dbAiPaneContextSummary }}</span>
            <button
              type="button"
              title="Use active tab context"
              @click="useActiveDbAiPaneContext"
            >
              <RefreshCw />
              <span>Use Active</span>
            </button>
          </div>
          <div class="db-ai-pane-pickers">
            <label>
              Connection
              <select
                class="db-ai-pane-connection"
                :value="dbAiPaneContext.connectionId"
                @change="updateDbAiPaneConnection"
              >
                <option
                  value=""
                  disabled
                >
                  Connection
                </option>
                <option
                  v-for="connection in connections"
                  :key="connection.id"
                  :value="connection.id"
                >
                  {{ connection.name }}{{ connection.status === 'testing' ? ' [connecting...]' : '' }}
                </option>
              </select>
            </label>
            <label>
              Database
              <select
                class="db-ai-pane-database"
                :value="dbAiPaneContext.catalogName"
                :disabled="dbAiPaneCatalogOptions.length === 0"
                @change="updateDbAiPaneCatalog"
              >
                <option
                  value=""
                  disabled
                >
                  Database
                </option>
                <option
                  v-for="catalog in dbAiPaneCatalogOptions"
                  :key="catalog.name"
                  :value="catalog.name"
                >
                  {{ catalog.name }}
                </option>
              </select>
            </label>
            <label v-if="dbAiPaneRequiresSchema">
              Schema
              <select
                class="db-ai-pane-schema"
                :value="dbAiPaneContext.schemaName"
                :disabled="dbAiPaneSchemaOptions.length === 0"
                @change="updateDbAiPaneSchema"
              >
                <option
                  value=""
                  disabled
                >
                  Schema
                </option>
                <option
                  v-for="schema in dbAiPaneSchemaOptions"
                  :key="schema.name"
                  :value="schema.name"
                >
                  {{ schema.name }}
                </option>
              </select>
            </label>
          </div>
          <div
            v-if="dbAiPaneConnectionNeedsConnect"
            class="db-ai-pane-connect-row"
          >
            <span>{{ dbAiPaneConnection?.name }} is not connected.</span>
            <button
              type="button"
              @click="connectDbAiPaneConnection"
            >
              <Zap />
              <span>Connect</span>
            </button>
          </div>
        </section>

        <section
          ref="dbAiPaneMessageListRef"
          class="db-ai-pane-messages"
        >
          <div
            v-if="dbAiPaneMessages.length === 0"
            class="db-ai-pane-empty"
          >
            <strong>{{ dbAiPaneContextTitle }}</strong>
            <span>Ask about schema, SQL, optimization, or generated read-only queries.</span>
          </div>
          <article
            v-for="message in dbAiPaneMessages"
            :key="message.id"
            class="db-ai-pane-message"
            :class="[message.role, message.status]"
            :data-message-id="message.id"
            :data-request-id="message.requestId"
          >
            <header>
              <strong>{{ message.role === 'user' ? 'You' : 'DB AI' }}</strong>
              <small>{{ formatDbAiRequestTime(message.createdAt) }}</small>
              <span
                v-if="message.role === 'assistant'"
                class="db-ai-pane-message-status"
              >
                {{ dbAiPaneStatusLabel(message.status) }}
              </span>
            </header>
            <p
              v-if="message.contextSummary"
              class="db-ai-pane-message-context"
            >
              {{ message.contextSummary }}
            </p>
            <pre>{{ message.content }}</pre>
          </article>
        </section>

        <footer class="db-ai-pane-composer">
          <div class="db-ai-pane-quick-actions">
            <button
              type="button"
              :disabled="!activeSqlTab"
              @click="sendDbAiPaneQuickPrompt('explainActive')"
            >
              Explain SQL
            </button>
            <button
              type="button"
              @click="sendDbAiPaneQuickPrompt('schemaSummary')"
            >
              Schema Summary
            </button>
            <button
              type="button"
              @click="sendDbAiPaneQuickPrompt('selectSample')"
            >
              Generate SELECT
            </button>
          </div>
          <textarea
            v-model="dbAiPaneDraft"
            rows="3"
            placeholder="Ask DB AI"
            @keydown="handleDbAiPaneDraftKeydown"
          />
          <div class="db-ai-pane-composer-actions">
            <button
              type="button"
              title="Reset conversation"
              @click="resetDbAiPaneConversation"
            >
              <RefreshCw />
            </button>
            <button
              v-if="dbAiPaneIsStreaming"
              type="button"
              title="Stop response"
              @click="cancelDbAiPaneResponse"
            >
              <X />
              <span>Stop</span>
            </button>
            <button
              type="button"
              class="primary"
              :disabled="!dbAiPaneCanSend"
              @click="() => sendDbAiPaneMessage()"
            >
              <Play />
              <span>Send</span>
            </button>
          </div>
        </footer>
      </div>
    </aside>

    <aside
      v-if="dbAiOpen"
      class="db-ai-drawer"
      :data-request-id="dbAiActiveReqId || undefined"
    >
      <header>
        <div>
          <strong>DB AI</strong>
          <span>{{ dbAiActionLabel }}</span>
        </div>
        <button
          type="button"
          title="Close"
          @click="dbAiOpen = false"
        >
          <X />
        </button>
      </header>
      <nav
        v-if="dbAiRequestList.length > 1"
        class="db-ai-request-list"
      >
        <button
          v-for="request in dbAiRequestList"
          :key="request.id"
          type="button"
          :data-request-id="request.id"
          :class="{ active: request.id === dbAiActiveReqId }"
          @click="setActiveDbAiRequest(request.id)"
        >
          <span :class="request.status"></span>
          <strong>{{ request.label }}</strong>
          <small>{{ formatDbAiRequestTime(request.updatedAt) }}</small>
        </button>
      </nav>
      <section>
        <p class="db-ai-status">
          <span :class="dbAiStatus"></span>
          {{ dbAiStatusLabel }}
        </p>
        <div
          v-if="dbAiContextSummary"
          class="db-ai-context"
        >
          {{ dbAiContextSummary }}
        </div>
        <div
          v-if="dbAiIsConvertAction"
          class="db-ai-dialect-row"
        >
          <label>
            Target Dialect
            <select v-model="dbAiTargetDialect">
              <option
                v-for="dialect in dbAiDialectOptions"
                :key="dialect.value"
                :value="dialect.value"
              >
                {{ dialect.label }}
              </option>
            </select>
          </label>
          <span
            v-if="!dbAiIsExecutableDialect"
            class="db-ai-hint"
          >
            Text-only conversion: target dialect does not match the active connection.
          </span>
        </div>
        <div
          v-if="dbAiReasoningText"
          class="db-ai-section"
        >
          <header>Reasoning</header>
          <pre>{{ dbAiReasoningText }}</pre>
        </div>
        <div
          v-if="dbAiContentText"
          class="db-ai-section"
        >
          <header>Response</header>
          <pre>{{ dbAiContentText }}</pre>
        </div>
        <div
          v-if="dbAiEmptyState"
          class="db-ai-empty"
        >
          No DB AI response is active.
        </div>
      </section>
      <section
        v-if="dbAiSql"
        class="db-ai-sql-actions"
      >
        <header>
          <span>Generated SQL</span>
          <button
            type="button"
            @click="copyDbAiSql"
          >
            Copy
          </button>
          <button
            type="button"
            :disabled="!activeSqlTab"
            @click="replaceDbAiSqlSelection"
          >
            Replace Selection
          </button>
          <button
            type="button"
            :disabled="!activeSqlTab"
            @click="insertDbAiSql"
          >
            Insert Into Editor
          </button>
          <button
            type="button"
            :disabled="!dbAiCanRunReadOnly"
            @click="runDbAiReadonly"
          >
            Run ReadOnly
          </button>
        </header>
        <pre>{{ dbAiSql }}</pre>
      </section>
      <footer>
        <button
          v-if="dbAiCanCancel"
          type="button"
          @click="cancelDbAiRequest"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="clearDbAiRequest"
        >
          Clear
        </button>
      </footer>
    </aside>

    <div
      v-if="addMenuOpen"
      class="db-popup-menu db-add-menu"
      :style="{ top: `${addMenuPosition.y}px`, left: `${addMenuPosition.x}px` }"
      @click.stop
    >
      <button
        type="button"
        @click="addGroup()"
      >
        New Group
      </button>
      <div class="db-popup-subtitle">New Connection</div>
      <button
        v-for="engine in databaseEngines"
        :key="engine.name"
        type="button"
        :title="`New ${engine.name} connection`"
        @click="openConnectionModalFromEngine(engine)"
      >
        <span
          class="db-engine-dot"
          :style="{ background: engine.accent }"
        />
        {{ engine.name }}
      </button>
    </div>

    <div
      v-if="contextMenu"
      class="db-popup-menu db-context-menu"
      :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
      @click.stop
    >
      <template v-if="contextMenu.type === 'group'">
        <div
          class="db-popup-submenu-wrap"
          @mouseenter="contextSubmenu = 'groupConnection'"
        >
          <button type="button">
            <span>New Connection</span>
            <span class="db-popup-arrow">›</span>
          </button>
          <div
            v-if="contextSubmenu === 'groupConnection'"
            class="db-popup-menu db-popup-submenu"
          >
            <button
              v-for="engine in databaseEngines"
              :key="`ctx-${engine.name}`"
              type="button"
              :title="`New ${engine.name} connection`"
              @click="openConnectionModalFromEngine(engine, contextMenu.groupId)"
            >
              <span
                class="db-engine-dot"
                :style="{ background: engine.accent }"
              />
              {{ engine.name }}
            </button>
          </div>
        </div>
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="addGroup(contextMenu.groupId)"
        >
          New Group
        </button>
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="startGroupRename(contextMenu.groupId)"
        >
          Rename
        </button>
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="copyContextName"
        >
          Copy Name
        </button>
        <div
          class="db-popup-submenu-wrap"
          @mouseenter="contextSubmenu = 'groupMove'"
        >
          <button type="button">
            <span>Move To</span>
            <span class="db-popup-arrow">›</span>
          </button>
          <div
            v-if="contextSubmenu === 'groupMove'"
            class="db-popup-menu db-popup-submenu"
          >
            <button
              type="button"
              :disabled="groupRootMoveDisabled"
              @click="moveGroupTo(contextMenu.groupId, null)"
            >
              Root Group
            </button>
            <button
              v-for="target in groupMoveTargets"
              :key="target.id"
              type="button"
              @click="moveGroupTo(contextMenu.groupId, target.id)"
            >
              {{ target.name }}
            </button>
            <button
              v-if="groupMoveTargets.length === 0 && groupRootMoveDisabled"
              type="button"
              disabled
            >
              Current Group
            </button>
          </div>
        </div>
        <div class="db-popup-divider" />
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="requestDeleteGroup(contextMenu.groupId)"
        >
          Delete Group
        </button>
      </template>
      <template v-else-if="contextMenu.type === 'connection'">
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="connectFromMenu(contextMenu.connectionId)"
        >
          {{ contextConnectionConnected ? 'Close Connection' : 'Open Connection' }}
        </button>
        <div class="db-popup-divider" />
        <button
          type="button"
          :disabled="!contextConnectionConnected"
          @mouseenter="closeContextSubmenuSoon"
          @click="contextConnectionConnected && openSqlConsole(contextMenu.connectionId)"
        >
          Query Console
        </button>
        <button
          type="button"
          :disabled="!contextConnectionCanCreateDatabase"
          @mouseenter="closeContextSubmenuSoon"
          @click="contextConnectionCanCreateDatabase && openCreateDatabaseModal(contextMenu.connectionId)"
        >
          Create Database
        </button>
        <div class="db-popup-divider" />
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="editConnection(contextMenu.connectionId)"
        >
          Editor Source
        </button>
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="copyContextName"
        >
          Copy Name
        </button>
        <div class="db-popup-divider" />
        <div
          class="db-popup-submenu-wrap"
          @mouseenter="contextSubmenu = 'connectionMove'"
        >
          <button type="button">
            <span>Move To</span>
            <span class="db-popup-arrow">›</span>
          </button>
          <div
            v-if="contextSubmenu === 'connectionMove'"
            class="db-popup-menu db-popup-submenu"
          >
            <button
              type="button"
              :disabled="connectionRootMoveDisabled"
              @click="moveConnectionToGroup(contextMenu.connectionId, DEFAULT_GROUP_ID)"
            >
              Root Group
            </button>
            <button
              v-for="target in connectionMoveTargets"
              :key="target.id"
              type="button"
              @click="moveConnectionToGroup(contextMenu.connectionId, target.id)"
            >
              {{ target.name }}
            </button>
            <button
              v-if="connectionMoveTargets.length === 0 && connectionRootMoveDisabled"
              type="button"
              disabled
            >
              Current Group
            </button>
          </div>
        </div>
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="refreshConnectionFromMenu(contextMenu.connectionId)"
        >
          Refresh
        </button>
        <div class="db-popup-divider" />
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="requestRemoveConnection(contextMenu.connectionId)"
        >
          Remove
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="openContextTable"
        >
          Open Table
        </button>
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="openContextSql"
        >
          Query Console
        </button>
        <div class="db-popup-divider" />
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="openDdlModalFromContext"
        >
          View DDL
        </button>
        <div
          class="db-popup-submenu-wrap"
          @mouseenter="contextSubmenu = 'tableCopy'"
        >
          <button type="button">
            <span>Copy Table</span>
            <span class="db-popup-arrow">›</span>
          </button>
          <div
            v-if="contextSubmenu === 'tableCopy'"
            class="db-popup-menu db-popup-submenu"
          >
            <button
              type="button"
              @click="copyContextName"
            >
              Copy Table Name
            </button>
            <button
              type="button"
              @click="copySelectSql"
            >
              Copy Table SELECT
            </button>
            <button
              type="button"
              @click="copyTableDdlFromContext"
            >
              Copy Table DDL
            </button>
          </div>
        </div>
        <div class="db-popup-divider" />
        <button
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="requestDangerousTableAction('truncate')"
        >
          Truncate
        </button>
        <button
          class="danger"
          type="button"
          @mouseenter="closeContextSubmenuSoon"
          @click="requestDangerousTableAction('drop')"
        >
          Drop
        </button>
      </template>
    </div>

    <div
      v-if="connectionModalOpen"
      class="db-modal-overlay"
      @click.self="closeConnectionModal"
    >
      <form
        class="db-connection-modal"
        @submit.prevent="saveConnectionDraft"
      >
        <button
          type="button"
          title="Close"
          @click="closeConnectionModal"
        >
          <X />
        </button>
        <header>
          <span
            class="db-engine-large"
            :style="{ background: engineAccent(connectionDraft.dbType) }"
          />
          <h2>{{ connectionModalMode === 'edit' ? 'Edit Connection' : engineName(connectionDraft.dbType) }}</h2>
        </header>
        <label>
          Name
          <input
            v-model="connectionDraft.name"
            :class="{ error: connectionErrors.includes('name') }"
            required
          />
        </label>
        <label>
          Env
          <select v-model="connectionDraft.env">
            <option>Development</option>
            <option>TEST</option>
            <option>Staging</option>
            <option>Production</option>
          </select>
        </label>
        <label>
          Group
          <select v-model="connectionDraft.groupId">
            <option
              v-for="group in groups"
              :key="group.id"
              :value="group.id"
            >
              {{ group.name }}
            </option>
          </select>
        </label>
        <label v-if="connectionDraft.dbType === 'sqlite'">
          File Path
          <div class="db-connection-file">
            <input
              v-model="connectionDraft.filePath"
              :class="{ error: connectionErrors.includes('filePath') }"
              required
              @input="markConnectionUrlAuto"
            />
            <button
              type="button"
              @click="pickSqliteFile"
            >
              Select
            </button>
          </div>
        </label>
        <label v-if="connectionDraft.dbType === 'sqlite'">
          Readonly
          <span class="db-connection-check">
            <input
              v-model="connectionDraft.readonly"
              type="checkbox"
            />
            <span>Open database in readonly mode</span>
          </span>
        </label>
        <template v-else>
          <label>
            Host
            <input
              v-model="connectionDraft.host"
              :class="{ error: connectionErrors.includes('host') }"
              :required="connectionDraft.dbType !== 'oracle' || !connectionDraft.url.trim()"
              @input="markConnectionUrlAuto"
            />
          </label>
          <label>
            Port
            <input
              v-model.number="connectionDraft.port"
              :class="{ error: connectionErrors.includes('port') }"
              min="1"
              max="65535"
              type="number"
              :required="connectionDraft.dbType !== 'oracle' || !connectionDraft.url.trim()"
              @input="markConnectionUrlAuto"
            />
          </label>
          <label>
            Authentication
            <select v-model="connectionDraft.authentication">
              <option>UserAndPassword</option>
            </select>
          </label>
          <label>
            User
            <input
              v-model="connectionDraft.user"
              :class="{ error: connectionErrors.includes('user') }"
              required
            />
          </label>
          <label>
            Password
            <div class="db-connection-password">
              <input
                v-model="connectionDraft.password"
                :type="passwordVisible ? 'text' : 'password'"
                :placeholder="connectionModalMode === 'edit' ? 'Leave empty to keep saved password' : ''"
                autocomplete="new-password"
              />
              <button
                type="button"
                :title="passwordVisible ? 'Hide password' : 'Show password'"
                @click="passwordVisible = !passwordVisible"
              >
                {{ passwordVisible ? 'Hide' : 'Show' }}
              </button>
            </div>
          </label>
          <label>
            {{ connectionDraft.dbType === 'oracle' ? 'Service' : 'Database' }}
            <input
              v-model="connectionDraft.database"
              @input="markConnectionUrlAuto"
            />
          </label>
          <label>
            SSH Proxy
            <span class="db-connection-check">
              <input
                v-model="connectionDraft.needProxy"
                type="checkbox"
              />
              <span>Route database traffic through a configured proxy</span>
            </span>
          </label>
          <label v-if="connectionDraft.needProxy && databaseProxyAvailable">
            Proxy
            <select
              v-model="connectionDraft.proxyName"
              :class="{ error: connectionErrors.includes('proxyName') }"
            >
              <option value="">Select proxy</option>
              <option
                v-for="proxy in databaseSshProxyOptions"
                :key="proxy.name"
                :value="proxy.name"
              >
                {{ proxy.name }} · {{ proxy.type }} {{ proxy.host }}:{{ proxy.port }}
              </option>
            </select>
          </label>
          <p
            v-else-if="connectionDraft.needProxy"
            class="db-modal-hint"
          >
            No SSH proxy config is available.
            <button
              type="button"
              @click="workspaceStore.openSshProxyConfig(); workspaceStore.openAddSshProxyConfig()"
            >
              Add Proxy
            </button>
          </p>
          <label v-if="isPostgresCompatibleDbType(connectionDraft.dbType)">
            SSL Mode
            <select v-model="connectionDraft.sslMode">
              <option value="">-</option>
              <option
                v-for="mode in postgresSslModeOptions"
                :key="mode"
                :value="mode"
              >
                {{ mode }}
              </option>
            </select>
          </label>
        </template>
        <label>
          {{ connectionDraft.dbType === 'oracle' ? 'Connect String' : 'URL' }}
          <input
            v-model="connectionUrl"
            :class="{ error: connectionErrors.includes('url') }"
          />
        </label>
        <p
          v-if="connectionFeedback"
          class="db-modal-feedback"
          :class="{ error: connectionFeedbackKind === 'error' }"
        >
          {{ connectionFeedback }}
        </p>
        <footer>
          <button
            type="button"
            :disabled="connectionTesting || connectionSaving"
            @click="testConnectionDraft"
          >
            {{ connectionTesting ? 'Testing...' : 'Test Connection' }}
          </button>
          <span />
          <button
            type="button"
            :disabled="connectionTesting || connectionSaving"
            @click="closeConnectionModal"
          >
            Cancel
          </button>
          <button
            type="submit"
            :disabled="connectionTesting || connectionSaving"
          >
            {{ connectionSaving ? 'Saving...' : 'Save' }}
          </button>
        </footer>
      </form>
    </div>

    <div
      v-if="createDatabaseModal.open"
      class="db-modal-overlay"
      @click.self="closeCreateDatabaseModal"
    >
      <form
        class="db-create-modal"
        @submit.prevent="createDatabase"
      >
        <header>
          <h2>Create Database</h2>
          <button
            type="button"
            title="Close"
            @click="closeCreateDatabaseModal"
          >
            <X />
          </button>
        </header>
        <label>
          Name:
          <input
            v-model="createDatabaseModal.name"
            :class="{ error: createDatabaseNameError }"
            required
            @input="updateCreateDatabaseName"
          />
        </label>
        <p
          v-if="createDatabaseNameError"
          class="db-modal-feedback error"
        >
          Use a valid identifier: start with a letter or underscore, then letters, numbers, or underscores.
        </p>
        <strong>Preview</strong>
        <textarea
          v-model="createDatabaseSql"
          spellcheck="false"
        />
        <p
          v-if="createDatabaseModal.feedback"
          class="db-modal-feedback"
          :class="{ error: createDatabaseModal.feedbackKind === 'error' }"
        >
          {{ createDatabaseModal.feedback }}
        </p>
        <footer>
          <button
            type="button"
            @click="closeCreateDatabaseModal"
          >
            Cancel
          </button>
          <button
            type="submit"
            :disabled="!createDatabaseCanSubmit"
          >
            Create
          </button>
        </footer>
      </form>
    </div>

    <div
      v-if="chartModal.open"
      class="db-modal-overlay"
      @click.self="closeChartModal"
    >
      <section class="db-chart-modal">
        <header>
          <div>
            <h2>{{ chartModal.summary?.title || 'Chart' }}</h2>
            <span>{{ chartModal.summary?.scopeLabel }}</span>
          </div>
          <button
            type="button"
            title="Close"
            @click="closeChartModal"
          >
            <X />
          </button>
        </header>
        <div
          v-if="chartModal.summary"
          class="db-chart-body"
        >
          <div class="db-chart-metrics">
            <span><strong>{{ chartModal.summary.rowCount }}</strong> Rows</span>
            <span><strong>{{ chartModal.summary.valueColumn }}</strong> Value</span>
            <span><strong>{{ chartModal.summary.categoryColumn }}</strong> Category</span>
          </div>
          <div class="db-chart-bars">
            <div
              v-for="bar in chartModal.summary.bars"
              :key="bar.label"
              class="db-chart-bar-row"
            >
              <span :title="bar.label">{{ bar.label }}</span>
              <div class="db-chart-track">
                <i :style="{ width: `${bar.width}%` }" />
              </div>
              <strong>{{ formatChartNumber(bar.value) }}</strong>
            </div>
          </div>
          <p class="db-chart-footnote">
            Numeric columns: {{ chartModal.summary.numericColumns.join(', ') }}
          </p>
        </div>
        <p
          v-else
          class="db-chart-empty"
        >
          {{ chartModal.error || 'Current page does not contain a numeric column to chart.' }}
        </p>
      </section>
    </div>

    <div
      v-if="commentModal.open"
      class="db-modal-overlay"
      @click.self="closeCommentModal"
    >
      <section class="db-comment-modal">
        <header>
          <div>
            <h2>{{ commentModal.title }}</h2>
            <span>{{ commentModal.scopeLabel }}</span>
          </div>
          <button
            type="button"
            title="Close"
            @click="closeCommentModal"
          >
            <X />
          </button>
        </header>
        <p
          v-if="commentModal.error"
          class="db-comment-error"
        >
          {{ commentModal.error }}
        </p>
        <textarea
          v-model="commentModal.draft"
          :disabled="commentModal.loading || commentModal.saving"
          maxlength="5000"
          spellcheck="false"
        />
        <footer>
          <span>{{ commentModal.updatedAt ? `Saved ${formatCommentTime(commentModal.updatedAt)}` : 'Not saved' }}</span>
          <div>
            <button
              type="button"
              :disabled="commentModal.loading || commentModal.saving"
              @click="closeCommentModal"
            >
              Cancel
            </button>
            <button
              type="button"
              :disabled="commentModal.loading || commentModal.saving"
              @click="saveActiveComment"
            >
              {{ commentModal.saving ? 'Saving' : 'Save' }}
            </button>
          </div>
        </footer>
      </section>
    </div>

    <div
      v-if="ddlModal.open"
      class="db-modal-overlay"
      @click.self="ddlModal.open = false"
    >
      <section class="db-ddl-modal">
        <header>
          <h2>DDL - {{ ddlModal.tableName }}</h2>
          <button
            type="button"
            title="Close"
            @click="ddlModal.open = false"
          >
            <X />
          </button>
        </header>
        <div class="db-ddl-toolbar">
          <button
            type="button"
            :disabled="!ddlModal.ddl || ddlModal.loading"
            @click="copyDdl"
          >
            Copy
          </button>
        </div>
        <p
          v-if="ddlModal.error"
          class="db-ddl-error"
        >
          {{ ddlModal.error }}
        </p>
        <textarea
          v-else
          :value="ddlModal.loading ? 'Loading DDL...' : ddlModal.ddl"
          readonly
          spellcheck="false"
        />
      </section>
    </div>

    <div
      v-if="dangerConfirm.open"
      class="db-modal-overlay"
      @click.self="cancelDangerousTableAction"
    >
      <section class="db-danger-confirm">
        <header>
          <h2>{{ dangerConfirm.action === 'drop' ? 'Drop Table' : 'Truncate Table' }}</h2>
          <button
            type="button"
            title="Close"
            @click="cancelDangerousTableAction"
          >
            <X />
          </button>
        </header>
        <p>
          {{ dangerConfirm.action === 'drop' ? 'This will remove the table in a real database.' : 'This will delete all table rows in a real database.' }}
        </p>
        <code>{{ dangerConfirm.sql }}</code>
        <label>
          Type table name to confirm
          <input
            v-model="dangerConfirm.confirmText"
            autocomplete="off"
          />
        </label>
        <footer>
          <button
            type="button"
            @click="cancelDangerousTableAction"
          >
            Cancel
          </button>
          <button
            class="danger"
            type="button"
            :disabled="dangerConfirm.confirmText !== dangerConfirm.tableName"
            @click="confirmDangerousTableAction"
          >
            Confirm
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="operationConfirm.open"
      class="db-modal-overlay"
      @click.self="cancelOperationConfirm"
    >
      <section class="db-operation-confirm">
        <header>
          <h2>{{ operationConfirm.title }}</h2>
          <button
            type="button"
            title="Close"
            @click="cancelOperationConfirm"
          >
            <X />
          </button>
        </header>
        <p>{{ operationConfirm.message }}</p>
        <code v-if="operationConfirm.detail">{{ operationConfirm.detail }}</code>
        <footer>
          <button
            type="button"
            @click="cancelOperationConfirm"
          >
            Cancel
          </button>
          <button
            class="danger"
            type="button"
            @click="confirmOperation"
          >
            {{ operationConfirm.confirmLabel }}
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="notice"
      class="db-toast"
    >
      {{ notice }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type ComponentPublicInstance, type PropType } from 'vue'
import {
  AlignLeft,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Columns3,
  CornerDownRight,
  Database,
  FileSearch,
  Folder,
  FolderOpen,
  Languages,
  LayoutDashboard,
  Lightbulb,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Save,
  SaveAll,
  Search,
  SquareTerminal,
  Table2,
  TextCursorInput,
  Unplug,
  WandSparkles,
  X,
  Zap
} from 'lucide-vue-next'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { editorLineHeightPx } from '@/services/editorRuntime'
import DatabaseSqlEditor, { type DatabaseSqlEditorMetrics } from '@/components/database/DatabaseSqlEditor.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type {
  DatabaseAiDrawerResponseInput,
  DatabaseAiDrawerResponseResult,
  DatabaseAiDrawerLifecycleResult,
  DatabaseAiDrawerRequestResult,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneResponseResult,
  DatabaseAiPaneStateSnapshot,
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionDeleteResult,
  DatabaseConnectionInfo,
  DatabaseConnectionMoveInput,
  DatabaseConnectionMutationResult,
  DatabaseCreateDatabaseResult,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseExportResult,
  DatabaseGroupCreateInput,
  DatabaseGroupInfo,
  DatabaseGroupDeleteResult,
  DatabaseGroupMutationResult,
  DatabaseGroupUpdateInput,
  LocalFileWriteResult,
  DatabasePageCommentKey,
  DatabasePageCommentRecord,
  DatabaseSqlExecutionRecord,
  DatabaseSqlExecuteResult,
  DatabaseTableDdlResult,
  DatabaseTableInfo,
  DatabaseTableMutation,
  DatabaseTableMutationPlanResult,
  DatabaseTableMutationResult,
  DatabaseTableQueryResult,
  DatabaseWorkspaceCatalog
} from '@shared/preload'

type DbFilter =
  | { column: string; operator: 'like' | 'eq' | 'neq'; value: string }
  | { column: string; operator: 'in'; values: string[] }
  | { column: string; operator: 'isnull' | 'notnull' }
type DbSort = { column: string; direction: 'asc' | 'desc' } | null
type DbOrderBy = Array<{ column: string; direction: 'asc' | 'desc' }>
type ResultStatus = 'running' | 'ok' | 'error'
type DbFilterValueEntry = { value: string; label: string; count: number }
type DbAiStatus = 'queued' | 'streaming' | 'done' | 'error' | 'cancelled'
type DirtyState = {
  newRows: Array<{ tmpId: string; values: Record<string, unknown> }>
  deletedRowKeys: Set<string>
  updatedCells: Map<string, Record<string, unknown>>
  originalRows: Map<string, Record<string, unknown>>
}
type EditOp =
  | { kind: 'add'; tmpId: string }
  | { kind: 'delete'; rowKey: string; snapshot: Record<string, unknown> }
  | { kind: 'update'; rowKey: string; column: string; oldValue: unknown; newValue: unknown }
type DataEditSummary = {
  isDirty: boolean
  newRows: number
  updatedRows: number
  deletedRows: number
  undoDepth: number
  statementCount: number
  preview: string
  warning: string
  error: string
}
type DataMutationPlanState = {
  key: string
  loading: boolean
  statementCount: number
  preview: string
  warning: string
  error: string
}
type DatabaseChartSource = {
  title: string
  scopeLabel: string
  columns: string[]
  rows: Array<Record<string, unknown>>
}
type DatabaseChartBar = {
  label: string
  value: number
  width: number
}
type DatabaseChartSummary = {
  title: string
  scopeLabel: string
  categoryColumn: string
  valueColumn: string
  rowCount: number
  bars: DatabaseChartBar[]
  numericColumns: string[]
}
type DbAiAction = 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete' | 'diagnose' | 'drop' | 'truncate'
type DbAiTargetDialect = DatabaseEngineCode | 'mssql'
type DbAiBackendContext = DatabaseAiDrawerResponseInput['context']
type TextRange = { start: number; end: number }
type DatabaseSqlEditorApi = {
  getText(): string
  getSelectedText(): string
  getTextUntilCursor(): string
  getCurrentStatement(): string
  getCurrentStatementRange(): TextRange
  getCursorOffset(): number
  getSelectionRange(): TextRange
  setSelectionRange(start: number, end?: number): void
  replaceAll(next: string): void
  replaceSelection(next: string): void
  replaceRange(next: string, range: TextRange): void
  insertAtCursor(next: string): void
  focus(): void
}
type TableReloadOptions = { withTotal?: boolean; preserveDirty?: boolean; notice?: string }
type ContextSubmenu = 'groupConnection' | 'groupMove' | 'connectionMove' | 'tableCopy' | null
type SchemaObjectKind = 'tables' | 'views' | 'functions' | 'procedures'
type SchemaObjectFolder = { kind: SchemaObjectKind; count: number; tables: DatabaseTableInfo[]; routines: string[] }
type TableDdlResult = { ok: true; ddl: string } | { ok: false; errorCode: string; errorMessage: string }

const DB_FILTER_NULL = '__AIOPSTERM_DB_NULL__'
const DB_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const DEFAULT_GROUP_ID = 'group-default'
const DB_AI_PANE_DEFAULT_WIDTH = 360
const DB_AI_PANE_MIN_WIDTH = 280
const DB_AI_PANE_MAX_WIDTH = 720
const DB_AI_ACTIONS: DbAiAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
const DB_AI_TARGET_DIALECTS: DbAiTargetDialect[] = ['mysql', 'postgresql', 'sqlite', 'oracle', 'mssql', 'clickhouse', 'presto']
const DB_ENGINE_CODES: DatabaseEngineCode[] = ['mysql', 'mariadb', 'oceanbase', 'postgresql', 'kingbase', 'sqlite', 'oracle', 'sqlserver', 'clickhouse', 'presto']
const DB_ENGINE_OPTION_CODES = [
  'mysql',
  'h2',
  'oracle',
  'postgresql',
  'sqlserver',
  'sqlite',
  'mariadb',
  'clickhouse',
  'dm',
  'presto',
  'db2',
  'oceanbase',
  'hive',
  'kingbase',
  'mongodb',
  'timeplus'
] as const
const isMysqlCompatibleDbType = (dbType: DatabaseEngineCode | DbAiTargetDialect | '') => dbType === 'mysql' || dbType === 'mariadb' || dbType === 'oceanbase'
const isPostgresCompatibleDbType = (dbType: DatabaseEngineCode | DbAiTargetDialect | '') => dbType === 'postgresql' || dbType === 'kingbase'
const connectionSchemeForDbType = (dbType: DatabaseEngineCode) =>
  dbType === 'postgresql'
    ? 'jdbc:postgresql'
    : dbType === 'kingbase'
      ? 'jdbc:kingbase8'
      : dbType === 'sqlserver'
        ? 'jdbc:sqlserver'
        : dbType === 'clickhouse' || dbType === 'presto'
          ? 'http'
          : dbType === 'mariadb'
            ? 'jdbc:mariadb'
            : dbType === 'oceanbase'
              ? 'jdbc:oceanbase'
              : 'jdbc:mysql'
const DATABASE_CATALOG_MALFORMED_MESSAGE = 'Database catalog backend returned malformed result data.'
const DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE = 'Database connection test backend returned malformed result data.'
const DATABASE_CONNECTION_SAVE_MALFORMED_MESSAGE = 'Database connection save backend returned malformed result data.'
const DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE = 'Database group backend returned malformed result data.'
const DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE = 'Database connection backend returned malformed result data.'
const DATABASE_CREATE_DATABASE_MALFORMED_MESSAGE = 'Create database backend returned malformed result data.'
const DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE = 'Backend table mutation returned malformed result data.'
const SQL_FILE_WRITE_MALFORMED_MESSAGE = 'SQL file writer returned malformed result data.'
const workspaceStore = useWorkspaceStore()

type SqlResult = {
  id: string
  title: string
  sql: string
  status: ResultStatus
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  error: string | null
  message: string
}
type SqlExecutionPayload = Omit<SqlResult, 'id' | 'title' | 'sql'>
type SqlExecutionOutcome = {
  payload: SqlExecutionPayload
  execution: DatabaseSqlExecutionRecord | null
}

type SqlResultViewState = {
  page: number
  pageSize: number
  filters: DbFilter[]
  sort: DbSort
}

type DbAiRequest = DatabaseAiDrawerRequestRecord
type DbAiPaneContext = {
  connectionId: string
  catalogName: string
  schemaName: string
  dbType: DatabaseEngineCode | ''
}
type DbAiPaneMessageStatus = DatabaseAiPaneMessageRecord['status']
type DbAiPaneMessage = DatabaseAiPaneMessageRecord
type DbAiPaneQuickPrompt = 'explainActive' | 'schemaSummary' | 'selectSample'

type SqlHistory = {
  id: string
  resultTabId: string | null
  title: string
  sql: string
  message: string
  status: Exclude<ResultStatus, 'running'>
  durationMs: number
  rowCount: number
  createdAt: string
}

type WorkspaceTab =
  | {
      id: string
      kind: 'overview'
      title: string
    }
  | {
      id: string
      kind: 'sql'
      title: string
      connectionId: string
      catalogName: string
      schemaName: string
      tableId?: string
      tableName?: string
      readOnly?: boolean
      sql: string
      filePath?: string
      savedSql: string
      saving: boolean
      saveError: string | null
      resultTabs: SqlResult[]
      activeResultTabId: string
      history: SqlHistory[]
    }
  | {
      id: string
      kind: 'data'
      title: string
      connectionId: string
      catalogName: string
      schemaName?: string
      tableId: string
      tableName: string
      columns: string[]
      sourceRows: Array<Record<string, unknown>>
      rows: Array<Record<string, unknown>>
      primaryKey: string[]
      whereRaw: string
      whereDraft: string
      orderByRaw: string
      orderByDraft: string
      page: number
      pageSize: number
      filters: DbFilter[]
      sort: DbSort
      selectedRowKey: string | null
      loading: boolean
      error: string | null
      total: number | null
      rowCount: number
      knownColumns: string[]
      durationMs: number
      dirtyState: DirtyState
      undoStack: EditOp[]
      mutationPlan: DataMutationPlanState
      saving: boolean
      saveError: string | null
    }

type ContextMenu =
  | { type: 'group'; groupId: string; label: string; x: number; y: number }
  | { type: 'connection'; connectionId: string; label: string; x: number; y: number }
  | {
      type: 'table'
      connectionId: string
      catalogName: string
      schemaName?: string
      tableId: string
      label: string
      x: number
      y: number
    }

type ContextMenuPayload = Omit<Extract<ContextMenu, { type: 'group' }>, 'x' | 'y'> | Omit<Extract<ContextMenu, { type: 'connection' }>, 'x' | 'y'> | Omit<Extract<ContextMenu, { type: 'table' }>, 'x' | 'y'>
type VisibleGroupNode = DatabaseGroupInfo & { depth: number }
type SqlConsoleContext = { connectionId: string; catalogName: string; schemaName: string }
type DatabaseOperationConfirmAction = 'deleteGroup' | 'removeConnection'

const DataGridToolbar = defineComponent({
  props: {
    page: { type: Number, required: true },
    pageSize: { type: Number, required: true },
    total: { type: Number as PropType<number | null>, default: null },
    canEdit: { type: Boolean, default: false },
    hasSelection: { type: Boolean, default: false },
    canUndo: { type: Boolean, default: false },
    isDirty: { type: Boolean, default: false },
    editDisabledReason: { type: String, default: '' },
    hideRefresh: { type: Boolean, default: false },
    canExport: { type: Boolean, default: false },
    exportTitle: { type: String, default: 'Export CSV' },
    canChart: { type: Boolean, default: false },
    chartTitle: { type: String, default: 'Chart' },
    canComment: { type: Boolean, default: false },
    commentTitle: { type: String, default: 'Comment' }
  },
  emits: ['gotoPage', 'gotoLastPage', 'changePageSize', 'refreshTotal', 'refresh', 'add-row', 'delete-row', 'undo', 'save', 'export', 'chart', 'comment'],
  setup(props, { emit }) {
    const pageSizes = [10, 50, 100, 500, 1000, 5000, 10000]
    const pageCount = computed(() =>
      props.total === null || props.total === undefined ? null : Math.max(1, Math.ceil(Math.max(0, props.total) / Math.max(1, props.pageSize)))
    )
    const atFirstPage = computed(() => props.page <= 1)
    const atLastPage = computed(() => pageCount.value !== null && props.page >= pageCount.value)
    const gotoPage = (page: number) => emit('gotoPage', Number.isFinite(page) && page > 0 ? Math.floor(page) : 1)
    const changePageSize = (size: number) => emit('changePageSize', Number.isFinite(size) && size > 0 ? Math.floor(size) : 100)
    const addRowTitle = computed(() => (props.canEdit ? 'Add row' : props.editDisabledReason || 'Editing is disabled for this result'))
    const deleteRowTitle = computed(() => {
      if (!props.canEdit) return props.editDisabledReason || 'Editing is disabled for this result'
      if (!props.hasSelection) return 'Select a row before deleting'
      return 'Delete row'
    })
    const undoTitle = computed(() => (props.canUndo ? 'Undo' : 'Nothing to undo'))
    const saveTitle = computed(() => {
      if (!props.canEdit) return props.editDisabledReason || 'Editing is disabled for this result'
      if (!props.isDirty) return 'No changes to save'
      return 'Save changes'
    })
    return () =>
      h('div', { class: 'db-toolbar' }, [
        h('div', { class: 'db-toolbar-group' }, [
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-first', disabled: atFirstPage.value, title: 'First page', onClick: () => gotoPage(1) }, '⏮'),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-prev', disabled: atFirstPage.value, title: 'Previous page', onClick: () => gotoPage(props.page - 1) }, '⏴'),
          h('input', {
            value: props.page,
            type: 'number',
            min: '1',
            onInput: (event: Event) => gotoPage(Number((event.target as HTMLInputElement).value) || 1)
          }),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-next', title: 'Next page', onClick: () => gotoPage(props.page + 1) }, '⏵'),
          h(
            'button',
            { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-last', disabled: pageCount.value === null || atLastPage.value, title: 'Last page', onClick: () => emit('gotoLastPage') },
            '⏭'
          ),
          h(
            'select',
            {
              value: props.pageSize,
              onChange: (event: Event) => changePageSize(Number((event.target as HTMLSelectElement).value))
            },
            pageSizes.map((size) => h('option', { value: size }, String(size)))
          ),
          h(
            'span',
            {
              class: 'db-toolbar-total',
              title: 'Refresh total',
              onClick: () => emit('refreshTotal')
            },
            ['Total: ', props.total === null || props.total === undefined ? h('span', { class: 'db-toolbar-total-unknown' }, '?') : String(props.total)]
          )
        ]),
        h('div', { class: 'db-toolbar-group' }, [
          !props.hideRefresh && h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-refresh', title: 'Refresh', onClick: () => emit('refresh') }, '↻'),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-add-row', disabled: !props.canEdit, title: addRowTitle.value, onClick: () => emit('add-row') }, '+'),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-delete-row', disabled: !props.canEdit || !props.hasSelection, title: deleteRowTitle.value, onClick: () => emit('delete-row') }, '-'),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-undo', disabled: !props.canUndo, title: undoTitle.value, onClick: () => emit('undo') }, '↶'),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-save', disabled: !props.canEdit || !props.isDirty, title: saveTitle.value, onClick: () => emit('save') }, '💾'),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-chart', disabled: !props.canChart, title: props.canChart ? props.chartTitle : 'No rows to chart', onClick: () => emit('chart') }, '📊'),
          h('button', { type: 'button', class: 'db-toolbar-btn db-toolbar-btn-comment', disabled: !props.canComment, title: props.canComment ? props.commentTitle : 'No page context for comment', onClick: () => emit('comment') }, '💬')
        ]),
        h('span', { class: 'db-toolbar-spacer' }),
        h(
          'button',
          {
            type: 'button',
            disabled: !props.canExport,
            class: 'db-toolbar-btn db-toolbar-export',
            title: props.canExport ? props.exportTitle : 'No rows to export',
            onClick: () => emit('export')
          },
          'Export ▾'
        )
      ])
  }
})

const DataStatusBar = defineComponent({
  props: {
    status: { type: String as PropType<ResultStatus>, default: 'ok' },
    error: { type: String, default: '' },
    message: { type: String, default: 'Execution OK' },
    durationMs: { type: Number, default: 0 },
    rowCount: { type: Number, default: 0 }
  },
  setup(props) {
    const hasError = computed(() => props.status === 'error' || !!props.error)
    return () =>
      h('div', { class: ['db-status-bar', { error: hasError.value, running: props.status === 'running' }] }, [
        hasError.value
          ? h('span', [h('b', '【Result】'), props.error])
          : props.status === 'running'
            ? [
                h('span', [h('b', '【Result】'), 'Running']),
                h('span', [h('b', '【Time】'), `${props.durationMs}ms`]),
                h('span', [h('b', '【Rows】'), `${props.rowCount} row`])
              ]
          : [
              h('span', [h('b', '【Result】'), props.message]),
              h('span', [h('b', '【Time】'), `${props.durationMs}ms`]),
              h('span', [h('b', '【Rows】'), `${props.rowCount} row`])
            ]
      ])
  }
})

const ResultGrid = defineComponent({
  props: {
    columns: { type: Array as PropType<string[]>, required: true },
    rows: { type: Array as PropType<Array<Record<string, unknown>>>, required: true },
    sourceRows: { type: Array as PropType<Array<Record<string, unknown>>>, default: () => [] },
    filters: { type: Array as PropType<DbFilter[]>, default: () => [] },
    sort: { type: Object as PropType<DbSort>, default: null },
    startRowIndex: { type: Number, default: 1 },
    selectedKey: { type: String, default: null },
    primaryKey: { type: Array as PropType<string[]>, default: () => [] },
    newRows: { type: Array as PropType<DirtyState['newRows']>, default: () => [] },
    deletedRowKeys: { type: Object as PropType<Set<string>>, default: () => new Set<string>() },
    updatedCells: { type: Object as PropType<Map<string, Record<string, unknown>>>, default: () => new Map<string, Record<string, unknown>>() },
    editable: { type: Boolean, default: false }
  },
  emits: ['sort', 'filter', 'select-row', 'cell-edit', 'new-row-cell-edit'],
  setup(props, { emit }) {
    const rootRef = ref<HTMLElement | null>(null)
    const editing = ref<{ origin: 'row' | 'new'; rowKey: string; column: string; value: string } | null>(null)
    const openFilterColumn = ref<string | null>(null)
    const filterPopoverRef = ref<HTMLElement | null>(null)
    const filterInputRef = ref<HTMLInputElement | null>(null)
    const filterAnchor = ref({ left: 8, top: 8 })
    const filterSearch = ref('')
    const filterSelection = ref<Set<string>>(new Set())
    const filterLoading = ref(false)
    const editInputRef = ref<HTMLInputElement | null>(null)
    const rowKey = (row: Record<string, unknown>, index: number) => {
      if (props.primaryKey.length) return JSON.stringify(props.primaryKey.map((key) => row[key]))
      return `row-${Math.max(0, props.startRowIndex - 1) + index}`
    }
    const displayCellValue = (row: Record<string, unknown>, key: string, column: string) => {
      const patch = props.updatedCells.get(key)
      if (patch && Object.prototype.hasOwnProperty.call(patch, column)) return patch[column]
      return row[column]
    }
    const formatCellValue = (value: unknown) => {
      try {
        if (value === null || value === undefined) return ''
        if (typeof value === 'string') return value
        if (typeof value === 'number' || typeof value === 'boolean') return String(value)
        if (typeof value === 'bigint') return value.toString()
        if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
        if (value instanceof Uint8Array) return new TextDecoder().decode(value)
        if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
        return String(value)
      } catch {
        return '<unrenderable>'
      }
    }
    const renderCellValue = (value: unknown) =>
      value === null || value === undefined ? h('span', { class: 'db-null' }, '<null>') : formatCellValue(value)
    const activeFilter = (column: string) => props.filters.find((filter) => filter.column === column) ?? null
    const filterValues = computed(() => {
      const column = openFilterColumn.value
      if (!column) return []
      return distinctFilterValues((props.sourceRows.length ? props.sourceRows : props.rows).map((row) => row[column]))
    })
    const visibleFilterValues = computed(() => {
      const needle = filterSearch.value.trim().toLowerCase()
      if (!needle) return filterValues.value
      return filterValues.value.filter((entry) => entry.label.toLowerCase().includes(needle))
    })
    const allVisibleSelected = computed(
      () => visibleFilterValues.value.length > 0 && visibleFilterValues.value.every((entry) => filterSelection.value.has(entry.value))
    )
    const someVisibleSelected = computed(() => visibleFilterValues.value.some((entry) => filterSelection.value.has(entry.value)))
    const filterPopoverStyle = computed(() => {
      const width = 260
      const maxHeight = 360
      const viewportWidth = window.innerWidth || 1024
      const viewportHeight = window.innerHeight || 768
      const left = Math.max(8, Math.min(filterAnchor.value.left, viewportWidth - width - 8))
      const top = Math.max(8, Math.min(filterAnchor.value.top, viewportHeight - maxHeight - 8))
      return {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`
      }
    })
    const seedFilterSelection = (column: string) => {
      const filter = activeFilter(column)
      const next = new Set<string>()
      if (filter?.operator === 'in') filter.values.forEach((value) => next.add(value))
      if (filter?.operator === 'eq' && filter.value !== undefined) next.add(filter.value)
      if (filter?.operator === 'isnull') next.add(DB_FILTER_NULL)
      filterSelection.value = next
    }
    const openFilter = (column: string, event: MouseEvent) => {
      event.stopPropagation()
      const trigger = event.currentTarget as HTMLElement | null
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        filterAnchor.value = { left: rect.left, top: rect.bottom + 2 }
      }
      if (openFilterColumn.value === column) {
        closeFilter()
        return
      }
      openFilterColumn.value = column
      filterLoading.value = true
      filterSearch.value = ''
      seedFilterSelection(column)
      nextTick(() => {
        if (openFilterColumn.value !== column) return
        filterInputRef.value?.focus()
        filterLoading.value = false
      })
    }
    const closeFilter = () => {
      openFilterColumn.value = null
      filterSearch.value = ''
      filterLoading.value = false
    }
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!openFilterColumn.value) return
      const target = event.target as Node | null
      if (!target) return
      if (filterPopoverRef.value?.contains(target)) return
      if (rootRef.value?.contains(target)) return
      closeFilter()
    }
    const toggleFilterValue = (value: string, checked: boolean) => {
      const next = new Set(filterSelection.value)
      if (checked) next.add(value)
      else next.delete(value)
      filterSelection.value = next
    }
    const toggleAllVisible = (checked: boolean) => {
      const next = new Set(filterSelection.value)
      visibleFilterValues.value.forEach((entry) => {
        if (checked) next.add(entry.value)
        else next.delete(entry.value)
      })
      filterSelection.value = next
    }
    const clearFilter = () => {
      if (openFilterColumn.value) emit('filter', openFilterColumn.value, null)
      closeFilter()
    }
    const applyFilter = () => {
      const column = openFilterColumn.value
      if (!column) return
      const selected = Array.from(filterSelection.value)
      if (selected.length === 0 || selected.length === filterValues.value.length) {
        emit('filter', column, null)
        closeFilter()
        return
      }
      const hasNull = selected.includes(DB_FILTER_NULL)
      const values = selected.filter((value) => value !== DB_FILTER_NULL)
      const nextFilter: DbFilter =
        hasNull && values.length === 0
          ? { column, operator: 'isnull' }
          : values.length === 1 && !hasNull
            ? { column, operator: 'eq', value: values[0] }
            : { column, operator: 'in', values }
      emit('filter', column, nextFilter)
      closeFilter()
    }
    const filterSummary = (column: string) => {
      const filter = activeFilter(column)
      if (!filter) return 'No filter'
      if (filter.operator === 'in') return `IN (${filter.values.length})`
      if (filter.operator === 'isnull') return 'IS NULL'
      if (filter.operator === 'notnull') return 'IS NOT NULL'
      if (filter.operator === 'eq' || filter.operator === 'neq' || filter.operator === 'like') return `${filter.operator.toUpperCase()} ${filter.value}`
      return 'No filter'
    }
    const startEdit = (origin: 'row' | 'new', rowKey: string, column: string, value: unknown) => {
      if (!props.editable) return
      if (origin === 'row' && props.deletedRowKeys.has(rowKey)) return
      editing.value = { origin, rowKey, column, value: formatCellValue(value) }
      nextTick(() => {
        editInputRef.value?.focus()
        editInputRef.value?.select()
      })
    }
    const commit = () => {
      if (!editing.value) return
      if (editing.value.origin === 'new') emit('new-row-cell-edit', editing.value.rowKey, editing.value.column, editing.value.value)
      else emit('cell-edit', editing.value.rowKey, editing.value.column, editing.value.value)
      editing.value = null
    }
    onMounted(() => {
      document.addEventListener('mousedown', onDocumentMouseDown, true)
    })
    onBeforeUnmount(() => {
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
    })
    return () =>
      h('div', { ref: rootRef, class: 'db-result', onClick: closeFilter }, [
        props.columns.length === 0
          ? h('div', { class: 'db-result-empty' }, 'No Results')
          : h('div', { class: 'db-result-table-wrap' }, [
              h('table', { class: 'db-result-table' }, [
                h('thead', [
                  h('tr', [
                    h('th', { class: 'index' }, '#'),
                    ...props.columns.map((column) =>
                      h('th', [
                        h('span', { class: 'db-th-label', onClick: () => emit('sort', column) }, column),
	                        h('span', { class: 'db-th-controls' }, [
                          activeFilter(column) &&
                            h(
                              'span',
                              {
                                class: 'db-filter-chip',
                                title: filterSummary(column)
                              },
                              filterSummary(column)
                            ),
                          h(
                            'button',
                            {
                              type: 'button',
                              class: { active: props.sort?.column === column },
                              title: 'Sort',
                              onClick: () => emit('sort', column)
                            },
                            props.sort?.column === column ? (props.sort.direction === 'asc' ? '▲' : '▼') : '⇅'
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              class: { active: props.filters.some((filter) => filter.column === column) },
                              title: 'Filter',
                              onClick: (event: MouseEvent) => openFilter(column, event)
                            },
                            '▾'
                          )
                        ])
                      ])
                    )
                  ])
                ]),
                h(
                  'tbody',
                  [
                    ...props.rows.map((row, index) => {
                    const key = rowKey(row, index)
                    const deleted = props.deletedRowKeys.has(key)
                    const rowPatch = props.updatedCells.get(key)
                    return h(
                      'tr',
                      {
                        class: { selected: props.selectedKey === key, deleted, updated: !!rowPatch && Object.keys(rowPatch).length > 0 },
                        onClick: () => emit('select-row', key)
                      },
                      [
                        h('td', { class: 'index' }, String(props.startRowIndex + index)),
                        ...props.columns.map((column) => {
                          const active = editing.value?.rowKey === key && editing.value.column === column
                          if (active) {
                            return h('td', [
                              h('input', {
                                ref: editInputRef,
                                value: editing.value?.value ?? '',
                                autofocus: true,
                                onInput: (event: Event) => {
                                  if (editing.value) editing.value.value = (event.target as HTMLInputElement).value
                                },
                                onBlur: commit,
                                onKeydown: (event: KeyboardEvent) => {
                                  if (event.key === 'Enter') commit()
                                  if (event.key === 'Escape') editing.value = null
                                }
                              })
                            ])
                          }
                          const value = displayCellValue(row, key, column)
                          return h(
                            'td',
                            {
                              class: { updated: !!rowPatch && Object.prototype.hasOwnProperty.call(rowPatch, column) },
                              onDblclick: () => startEdit('row', key, column, value)
                            },
                            renderCellValue(value)
                          )
                        })
                      ]
                    )
                  }),
                    ...props.newRows.map((newRow) =>
                      h(
                        'tr',
                        {
                          class: { new: true, selected: props.selectedKey === newRow.tmpId },
                          onClick: () => emit('select-row', newRow.tmpId)
                        },
                        [
                          h('td', { class: 'index' }, '*'),
                          ...props.columns.map((column) => {
                            const active = editing.value?.rowKey === newRow.tmpId && editing.value.column === column
                            if (active) {
                              return h('td', [
                                h('input', {
                                  ref: editInputRef,
                                  value: editing.value?.value ?? '',
                                  autofocus: true,
                                  onInput: (event: Event) => {
                                    if (editing.value) editing.value.value = (event.target as HTMLInputElement).value
                                  },
                                  onBlur: commit,
                                  onKeydown: (event: KeyboardEvent) => {
                                    if (event.key === 'Enter') commit()
                                    if (event.key === 'Escape') editing.value = null
                                  }
                                })
                              ])
                            }
                            const value = newRow.values[column]
                            return h(
                              'td',
                              {
                                onDblclick: () => startEdit('new', newRow.tmpId, column, value)
                              },
                              renderCellValue(value)
                            )
                          })
                        ]
                      )
                    )
                  ]
                )
              ])
            ]),
        openFilterColumn.value &&
          h('div', { ref: filterPopoverRef, class: 'db-filter-popover', style: filterPopoverStyle.value, onClick: (event: MouseEvent) => event.stopPropagation() }, [
            h('div', { class: 'db-filter-search' }, [
              h('span', '⌕'),
              h('input', {
                ref: filterInputRef,
                value: filterSearch.value,
                placeholder: `Search ${openFilterColumn.value}`,
                onInput: (event: Event) => {
                  filterSearch.value = (event.target as HTMLInputElement).value
                },
                onKeydown: (event: KeyboardEvent) => {
                  if (event.key === 'Enter') applyFilter()
                  if (event.key === 'Escape') closeFilter()
                }
	              })
            ]),
            h('label', { class: 'db-filter-row all' }, [
              h('input', {
                type: 'checkbox',
                checked: allVisibleSelected.value,
                indeterminate: someVisibleSelected.value && !allVisibleSelected.value,
                onChange: (event: Event) => toggleAllVisible((event.target as HTMLInputElement).checked)
              }),
              h('span', 'All'),
              h('button', { type: 'button', onClick: clearFilter }, 'Clear')
            ]),
            h(
              'div',
              { class: ['db-filter-list', { loading: filterLoading.value }] },
              filterLoading.value
                ? h('div', { class: 'db-filter-empty loading' }, 'Loading...')
                : visibleFilterValues.value.length
                ? visibleFilterValues.value.map((entry) =>
                    h('label', { key: entry.value, class: 'db-filter-row' }, [
                      h('input', {
                        type: 'checkbox',
                        checked: filterSelection.value.has(entry.value),
                        onChange: (event: Event) => toggleFilterValue(entry.value, (event.target as HTMLInputElement).checked)
                      }),
                      h('span', { title: entry.label }, entry.label),
                      h('small', `(${entry.count})`)
                    ])
                  )
                : h('div', { class: 'db-filter-empty' }, 'No Results')
            ),
            h('footer', { class: 'db-filter-footer' }, [
              h('button', { type: 'button', onClick: closeFilter }, 'Cancel'),
              h('button', { type: 'button', class: 'primary', onClick: applyFilter }, 'Apply')
            ])
          ])
      ])
  }
})

const databaseEngines = ref<DatabaseEngineInfo[]>([])
const groups = ref<DatabaseGroupInfo[]>([])
const groupParentById = reactive<Record<string, string | null>>({})
const connections = ref<DatabaseConnectionInfo[]>([])
const keyword = ref('')
const sidebarCollapsed = ref(false)
const expandedGroups = ref<string[]>([])
const expandedConnections = ref<string[]>([])
const expandedCatalogs = ref<string[]>([])
const expandedSchemas = ref<string[]>([])
const expandedSchemaObjectFolders = ref<string[]>([])
const expandedTables = ref<string[]>([])
const selectedNodeId = ref<string | null>(null)
const overflowOpen = ref(false)
const addMenuOpen = ref(false)
const addButtonRef = ref<HTMLButtonElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const addMenuPosition = ref({ x: 0, y: 0 })
const contextMenu = ref<ContextMenu | null>(null)
const contextSubmenu = ref<ContextSubmenu>(null)
const notice = ref('')
const noticeTimer = ref<number | null>(null)
const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')

const tabs = ref<WorkspaceTab[]>([{ id: 'tab-overview', kind: 'overview', title: 'Overview' }])
const activeTabId = ref('tab-overview')
const resultSeq = ref(1)
const sqlEditorRef = ref<DatabaseSqlEditorApi | null>(null)
const sqlFindInputRef = ref<HTMLInputElement | null>(null)
const sqlReplaceInputRef = ref<HTMLInputElement | null>(null)
const SQL_PANE_DEFAULT_PERCENT = 45
const SQL_PANE_MIN_PERCENT = 20
const SQL_PANE_MAX_PERCENT = 80
const sqlPaneEditorPercent = ref(SQL_PANE_DEFAULT_PERCENT)
const sqlPaneResizing = ref(false)
const sqlEditorScrollTop = ref(0)
const sqlEditorActiveLine = ref(1)
const sqlEditorActiveColumn = ref(1)
const sqlEditorSelectionSize = ref(0)
const sqlFindOpen = ref(false)
const sqlFindReplaceOpen = ref(false)
const sqlFindQuery = ref('')
const sqlFindReplace = ref('')
const sqlFindCaseSensitive = ref(false)
const sqlFindActiveIndex = ref(-1)
const workspaceTabRefs = new Map<string, HTMLElement>()

const connectionModalOpen = ref(false)
const connectionModalMode = ref<'create' | 'edit'>('create')
const connectionFeedback = ref('')
const connectionFeedbackKind = ref<'info' | 'error'>('info')
const connectionErrors = ref<string[]>([])
const connectionUrlDirty = ref(false)
const passwordVisible = ref(false)
const connectionTesting = ref(false)
const connectionSaving = ref(false)
const postgresSslModeOptions = ['disable', 'require', 'verify-ca', 'verify-full'] as const
const connectionDraft = reactive({
  id: '',
  dbType: 'mysql' as DatabaseEngineCode,
  name: '',
  env: 'Development' as DatabaseConnectionInfo['env'],
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 3306 as number | null,
  authentication: 'UserAndPassword' as DatabaseConnectionInfo['authentication'],
  user: 'root',
  password: '',
  database: '',
  filePath: '',
  readonly: false,
  sslMode: '' as NonNullable<DatabaseConnectionInfo['sslMode']>,
  needProxy: false,
  proxyName: '',
  url: ''
})

const createDatabaseModal = reactive({
  open: false,
  connectionId: '',
  dbType: 'mysql' as Extract<DatabaseEngineCode, 'mysql' | 'mariadb' | 'oceanbase' | 'postgresql' | 'kingbase' | 'sqlserver' | 'clickhouse'>,
  name: '',
  sql: '',
  userEditedSql: false,
  lastAppliedTemplate: '',
  submitting: false,
  feedback: '',
  feedbackKind: 'info' as 'info' | 'error'
})
const ddlModal = reactive({
  open: false,
  tableName: '',
  ddl: '',
  connectionId: '',
  catalogName: '',
  schemaName: '',
  tableId: '',
  loading: false,
  error: '',
  errorCode: '' as '' | 'permission' | 'other'
})
const chartModal = reactive({
  open: false,
  summary: null as DatabaseChartSummary | null,
  error: ''
})
const commentModal = reactive({
  open: false,
  title: '',
  scopeLabel: '',
  key: null as DatabasePageCommentKey | null,
  draft: '',
  updatedAt: 0,
  loading: false,
  saving: false,
  error: ''
})
const dbAiPaneOpen = ref(false)
const dbAiPaneWidth = ref(DB_AI_PANE_DEFAULT_WIDTH)
const dbAiPaneResizing = ref(false)
const dbAiPaneContext = reactive<DbAiPaneContext>({
  connectionId: '',
  catalogName: '',
  schemaName: '',
  dbType: ''
})
const dbAiPaneDraft = ref('')
const dbAiPaneMessages = ref<DbAiPaneMessage[]>([])
const dbAiPaneMessageListRef = ref<HTMLElement | null>(null)
let dbAiPaneResizeStartX = 0
let dbAiPaneResizeStartWidth = DB_AI_PANE_DEFAULT_WIDTH
let dbAiPaneContextTouched = false
let dbAiPaneStateHydrating = false
let dbAiPaneStateNoticeShown = false
const dbAiOpen = ref(false)
const dbAiRequests = ref<Record<string, DbAiRequest>>({})
const dbAiActiveReqId = ref<string | null>(null)
const sqlDiagnose = reactive({
  running: false,
  error: '',
  success: false,
  resultId: ''
})
let sqlDiagnoseSuccessTimer: number | null = null
let sqlPaneResizeElement: HTMLElement | null = null
const dbAiDialectOptions: Array<{ value: DbAiTargetDialect; label: string }> = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'mssql', label: 'SQL Server' },
  { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'presto', label: 'Presto' }
]
const dangerConfirm = reactive({
  open: false,
  action: 'drop' as 'drop' | 'truncate',
  connectionId: '',
  catalogName: '',
  schemaName: '',
  tableId: '',
  tableName: '',
  sql: '',
  confirmText: ''
})
const operationConfirm = reactive({
  open: false,
  action: '' as DatabaseOperationConfirmAction | '',
  targetId: '',
  title: '',
  message: '',
  detail: '',
  confirmLabel: 'Delete'
})

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value))
const activeSqlTab = computed(() => (activeTab.value?.kind === 'sql' ? activeTab.value : null))
const activeDataTab = computed(() => (activeTab.value?.kind === 'data' ? activeTab.value : null))
const activeDataEditSummary = computed(() => (activeDataTab.value ? buildDataEditSummary(activeDataTab.value) : null))
const sqlResultViewStateById = reactive<Record<string, SqlResultViewState>>({})
const emptySqlResultViewState: SqlResultViewState = Object.freeze({ page: 1, pageSize: 100, filters: [], sort: null }) as SqlResultViewState

const activeSqlCanRun = computed(() => {
  const tab = activeSqlTab.value
  if (!tab) return false
  return isSqlConsoleContextReady(tab)
})

const currentSqlCatalogs = computed(() => {
  const tab = activeSqlTab.value
  return tab ? (findConnection(tab.connectionId)?.catalogs ?? []) : []
})

const currentSqlSchemas = computed(() => {
  const tab = activeSqlTab.value
  if (!tab) return []
  const catalog = findConnection(tab.connectionId)?.catalogs.find((item) => item.name === tab.catalogName)
  return catalog?.schemas ?? []
})

const activeSqlRequiresSchema = computed(() => {
  const tab = activeSqlTab.value
  const connection = tab ? findConnection(tab.connectionId) : undefined
  return !!connection && sqlConnectionRequiresSchema(connection)
})

const databaseSshProxyOptions = computed(() => workspaceStore.sshProxyConfigs.map((config) => ({ ...config })).sort((first, second) => first.name.localeCompare(second.name)))
const databaseSshProxyNames = computed(() => new Set(databaseSshProxyOptions.value.map((config) => config.name)))
const databaseProxyAvailable = computed(() => connectionDraft.dbType !== 'sqlite' && databaseSshProxyOptions.value.length > 0)

const contextConnection = computed(() => {
  const menu = contextMenu.value
  return menu?.type === 'connection' ? (findConnection(menu.connectionId) ?? null) : null
})

const contextConnectionConnected = computed(() => contextConnection.value?.status === 'connected')
const contextConnectionCanCreateDatabase = computed(() => {
  const connection = contextConnection.value
  return (
    !!connection &&
    connection.status === 'connected' &&
    (isMysqlCompatibleDbType(connection.dbType) ||
      isPostgresCompatibleDbType(connection.dbType) ||
      connection.dbType === 'sqlserver' ||
      connection.dbType === 'clickhouse')
  )
})
const connectionMoveTargets = computed(() => {
  const connection = contextConnection.value
  if (!connection) return []
  return groups.value
    .filter((group) => group.id !== connection.groupId)
    .filter((group) => group.id !== DEFAULT_GROUP_ID)
    .map((group) => ({ id: group.id, name: groupPathLabel(group.id) }))
})
const connectionRootMoveDisabled = computed(() => contextConnection.value?.groupId === DEFAULT_GROUP_ID)

const activeSqlResult = computed(() => {
  const tab = activeSqlTab.value
  if (!tab || tab.activeResultTabId === 'overview') return null
  return tab.resultTabs.find((result) => result.id === tab.activeResultTabId) ?? null
})

const activeSqlResultViewState = computed(() => {
  const result = activeSqlResult.value
  return result ? getOrCreateSqlResultViewState(result.id) : emptySqlResultViewState
})

const activeSqlHasText = computed(() => Boolean(activeSqlTab.value?.sql.trim()))
const activeSqlSaving = computed(() => Boolean(activeSqlTab.value?.saving))
const activeSqlIsDirty = computed(() => {
  const tab = activeSqlTab.value
  return !!tab && tab.sql !== tab.savedSql
})
const activeSqlSaveTitle = computed(() => {
  const tab = activeSqlTab.value
  if (!tab) return 'Save'
  if (tab.saving) return 'Saving'
  return 'Save'
})
const activeSqlSaveStateText = computed(() => {
  const tab = activeSqlTab.value
  if (!tab) return ''
  if (tab.saving) return 'Saving...'
  if (tab.saveError) return tab.saveError
  if (activeSqlIsDirty.value) return tab.filePath ? 'Unsaved changes' : 'Not saved'
  return tab.filePath ? `Saved: ${fileNameFromPath(tab.filePath)}` : 'Not saved'
})
const canToggleDbAiPane = computed(() => connections.value.length > 0)
const sqlEditorLineHeight = computed(() => editorLineHeightPx(workspaceStore.editorSettings))
const databaseWorkspaceStyle = computed(() => ({
  '--db-ai-pane-width': dbAiPaneOpen.value ? `${dbAiPaneWidth.value}px` : '0px',
  '--db-sql-editor-line-height': `${sqlEditorLineHeight.value}px`,
  '--db-sql-editor-font-size': `${workspaceStore.editorSettings.fontSize}px`,
  '--db-sql-editor-tab-size': `${workspaceStore.editorSettings.tabSize}`
}))
const sqlPaneStyle = computed(() => ({
  '--db-sql-editor-percent': `${sqlPaneEditorPercent.value}%`,
  '--db-sql-result-percent': `${100 - sqlPaneEditorPercent.value}%`,
  '--db-sql-editor-ratio': `${sqlPaneEditorPercent.value}fr`,
  '--db-sql-result-ratio': `${100 - sqlPaneEditorPercent.value}fr`
}))
const activeSqlEditorLineCount = computed(() => Math.max(1, (activeSqlTab.value?.sql.match(/\n/g)?.length ?? 0) + 1))
const activeSqlEditorLines = computed(() => Array.from({ length: activeSqlEditorLineCount.value }, (_, index) => index + 1))
const sqlEditorActiveLineTop = computed(() => Math.max(0, (sqlEditorActiveLine.value - 1) * sqlEditorLineHeight.value - sqlEditorScrollTop.value))
const sqlFindMatches = computed<TextRange[]>(() => findSqlTextMatches(activeSqlTab.value?.sql ?? '', sqlFindQuery.value, sqlFindCaseSensitive.value))
const sqlFindSummary = computed(() => {
  if (!sqlFindQuery.value) return 'Find'
  if (!sqlFindMatches.value.length) return 'No results'
  return `${sqlFindActiveIndex.value >= 0 ? sqlFindActiveIndex.value + 1 : 0}/${sqlFindMatches.value.length}`
})
const dbAiPaneConnection = computed(() => findConnection(dbAiPaneContext.connectionId) ?? null)
const dbAiPaneCatalogOptions = computed(() => dbAiPaneConnection.value?.catalogs ?? [])
const dbAiPaneCatalog = computed(() => dbAiPaneCatalogOptions.value.find((catalog) => catalog.name === dbAiPaneContext.catalogName) ?? null)
const dbAiPaneSchemaOptions = computed(() => dbAiPaneCatalog.value?.schemas ?? [])
const dbAiPaneRequiresSchema = computed(() => !!dbAiPaneConnection.value && sqlConnectionRequiresSchema(dbAiPaneConnection.value))
const dbAiPaneConnectionNeedsConnect = computed(() => {
  const connection = dbAiPaneConnection.value
  return !!connection && connection.status !== 'connected' && connection.status !== 'testing'
})
const dbAiPaneContextTitle = computed(() => dbAiPaneContextSummary.value || 'No database context selected')
const dbAiPaneContextSummary = computed(() => {
  const connection = dbAiPaneConnection.value
  if (!connection) return 'No database context selected'
  return [connection.name, connection.dbType, dbAiPaneContext.catalogName, dbAiPaneContext.schemaName].filter(Boolean).join(' · ')
})
const dbAiPaneIsStreaming = computed(() =>
  dbAiPaneMessages.value.some((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'))
)
const dbAiPaneCanSend = computed(() => Boolean(dbAiPaneDraft.value.trim() && dbAiPaneContext.connectionId && dbAiPaneContext.catalogName && !dbAiPaneIsStreaming.value))
const dbAiRequestList = computed(() => Object.values(dbAiRequests.value).sort((a, b) => b.createdAt - a.createdAt))
const activeDbAiRequest = computed(() => {
  const id = dbAiActiveReqId.value
  return id ? (dbAiRequests.value[id] ?? null) : null
})
const dbAiTargetDialect = computed<DbAiTargetDialect>({
  get() {
    return activeDbAiRequest.value?.targetDialect ?? 'postgresql'
  },
  set(value) {
    const request = activeDbAiRequest.value
    if (!request) return
    patchDbAiRequest(request.id, {
      targetDialect: value
    })
    if (request.action === 'convert' && request.status !== 'cancelled') {
      void requestDbAiDrawerResponse(request.id)
    }
  }
})
const dbAiActionLabel = computed(() => activeDbAiRequest.value?.label ?? 'DB AI')
const dbAiAction = computed<DbAiAction>(() => activeDbAiRequest.value?.action ?? 'explain')
const dbAiSourceSql = computed(() => activeDbAiRequest.value?.sourceSql ?? '')
const dbAiText = computed(() => activeDbAiRequest.value?.text ?? '')
const dbAiStatus = computed<DbAiStatus | 'idle'>(() => activeDbAiRequest.value?.status ?? 'idle')
const dbAiContextSummary = computed(() => activeDbAiRequest.value?.contextSummary ?? '')
const dbAiSql = computed(() => (dbAiStatus.value === 'done' ? extractSql(dbAiText.value) : ''))
const dbAiIsConvertAction = computed(() => dbAiAction.value === 'convert')
const dbAiReasoningText = computed(() => {
  const fenceIndex = dbAiText.value.search(/```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|tsql|clickhouse|presto)?\s*\n/i)
  const text = fenceIndex >= 0 ? dbAiText.value.slice(0, fenceIndex).trim() : dbAiText.value.trim()
  return text.replace(/^Reasoning\s*\n?/i, '').trim()
})
const dbAiContentText = computed(() => {
  const sql = dbAiSql.value
  if (!sql || !dbAiText.value.trim()) return ''
  if (dbAiAction.value === 'convert') return `Generated ${dbAiDialectLabel(dbAiTargetDialect.value)} SQL preview.`
  if (dbAiAction.value === 'diagnose') return 'Generated a conservative read-only SQL diagnosis candidate.'
  if (dbAiAction.value === 'optimize') return 'Generated an optimized read-only SQL candidate.'
  if (dbAiAction.value === 'complete') return 'Generated a completed SQL candidate for the active editor context.'
  if (dbAiAction.value === 'nl2sql') return 'Generated SQL from the natural-language request and current database context.'
  return 'Generated SQL is ready for copy, replacement, insertion, or read-only execution when allowed.'
})

const dbAiStatusLabel = computed(() => {
  if (dbAiStatus.value === 'queued') return 'Queued'
  if (dbAiStatus.value === 'streaming') return 'Streaming'
  if (dbAiStatus.value === 'cancelled') return 'Cancelled'
  if (dbAiStatus.value === 'error') return 'Error'
  if (dbAiStatus.value === 'done') return 'Done'
  return 'Idle'
})

const dbAiIsExecutableDialect = computed(() => {
  return isDbAiExecutableDialect(dbAiAction.value, dbAiTargetDialect.value)
})

const dbAiCanRunReadOnly = computed(() => Boolean(activeSqlCanRun.value && dbAiIsExecutableDialect.value && isReadOnlySql(dbAiSql.value)))
const dbAiCanCancel = computed(() => dbAiStatus.value === 'queued' || dbAiStatus.value === 'streaming')
const dbAiEmptyState = computed(() => dbAiOpen.value && !activeDbAiRequest.value)

const visibleGroups = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return groups.value
  return groups.value.filter((group) => {
    if (group.name.toLowerCase().includes(needle)) return true
    return connections.value.some((connection) => connection.groupId === group.id && connectionText(connection).includes(needle))
  })
})

const visibleGroupNodes = computed<VisibleGroupNode[]>(() => flattenVisibleGroups(visibleGroups.value))

const contextGroup = computed(() => {
  const menu = contextMenu.value
  return menu?.type === 'group' ? (groups.value.find((group) => group.id === menu.groupId) ?? null) : null
})

const groupRootMoveDisabled = computed(() => !contextGroup.value || groupParentById[contextGroup.value.id] === null)

const groupMoveTargets = computed(() => {
  const group = contextGroup.value
  if (!group) return []
  const descendants = collectDescendantGroupIds(group.id)
  return groups.value
    .filter((target) => target.id !== DEFAULT_GROUP_ID && target.id !== group.id && !descendants.has(target.id))
    .map((target) => ({ id: target.id, name: groupPathLabel(target.id) }))
})

const filteredDataRows = computed(() => {
  const tab = activeDataTab.value
  if (!tab) return []
  return tab.rows
})
const activeDataWherePending = computed(() => {
  const tab = activeDataTab.value
  return !!tab && tab.whereDraft.trim() !== tab.whereRaw
})
const pagedDataRows = computed(() => {
  const tab = activeDataTab.value
  if (!tab) return []
  return tab.rows
})

const filteredSqlRows = computed(() => {
  const result = activeSqlResult.value
  if (!result || result.status === 'error') return []
  const state = activeSqlResultViewState.value
  return applySort(applyFilters(result.rows, state.filters), state.sort)
})

const pagedSqlRows = computed(() => {
  const result = activeSqlResult.value
  if (!result || result.status === 'error') return []
  const state = activeSqlResultViewState.value
  const start = (state.page - 1) * state.pageSize
  return filteredSqlRows.value.slice(start, start + state.pageSize)
})

const connectionUrl = computed({
  get() {
    if (connectionUrlDirty.value && connectionDraft.url.trim()) return connectionDraft.url
    return buildConnectionUrl()
  },
  set(value: string) {
    connectionUrlDirty.value = true
    connectionDraft.url = value
  }
})

function buildConnectionUrl() {
  if (connectionDraft.dbType === 'sqlite') return connectionDraft.filePath ? `sqlite://${connectionDraft.filePath}` : 'sqlite://'
  const host = connectionDraft.host || ''
  const port = connectionDraft.port ? `:${connectionDraft.port}` : ''
  const database = connectionDraft.database ? `/${connectionDraft.database}` : ''
  if (connectionDraft.dbType === 'oracle') return `${host}${port}${database}`
  const scheme = connectionSchemeForDbType(connectionDraft.dbType)
  if (connectionDraft.dbType === 'clickhouse' || connectionDraft.dbType === 'presto') return `${scheme}://${host}${port}`
  return `${scheme}://${host}${port}${database}`
}

function markConnectionUrlAuto() {
  if (!connectionUrlDirty.value) connectionDraft.url = ''
  clearConnectionFeedback()
}

function clearConnectionFeedback() {
  connectionFeedback.value = ''
  connectionFeedbackKind.value = 'info'
}

function sqlConnectionRequiresSchema(connection: DatabaseConnectionInfo) {
  return isPostgresCompatibleDbType(connection.dbType) || connection.dbType === 'oracle' || connection.dbType === 'sqlserver' || connection.dbType === 'presto'
}

function defaultSchemaForSqlConnection(connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined) {
  if (!connection || !catalog || !sqlConnectionRequiresSchema(connection)) return ''
  if (!catalog.schemas?.length) return ''
  return catalog.schemas.find((schema) => schema.name === 'public')?.name ?? catalog.schemas[0]?.name ?? ''
}

function repairSqlTabContext(tab: Extract<WorkspaceTab, { kind: 'sql' }>) {
  const connection = findConnection(tab.connectionId)
  if (!connection) {
    tab.connectionId = ''
    tab.catalogName = ''
    tab.schemaName = ''
    tab.tableId = undefined
    tab.tableName = undefined
    return
  }
  const catalog = connection.catalogs.find((item) => item.name === tab.catalogName) ?? connection.catalogs[0]
  if (!catalog) {
    tab.catalogName = ''
    tab.schemaName = ''
    tab.tableId = undefined
    tab.tableName = undefined
    return
  }
  if (tab.catalogName !== catalog.name) {
    tab.catalogName = catalog.name
    tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
    tab.tableId = undefined
    tab.tableName = undefined
    return
  }
  if (sqlConnectionRequiresSchema(connection)) {
    const schema = catalog.schemas?.find((item) => item.name === tab.schemaName)
    if (!schema) {
      tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
      tab.tableId = undefined
      tab.tableName = undefined
      return
    }
    if (tab.tableId && !schema.tables.some((table) => table.id === tab.tableId)) {
      tab.tableId = undefined
      tab.tableName = undefined
    }
    return
  }
  if (tab.schemaName) tab.schemaName = ''
  if (tab.tableId && !(catalog.tables ?? []).some((table) => table.id === tab.tableId)) {
    tab.tableId = undefined
    tab.tableName = undefined
  }
}

function repairTabsForConnection(connectionId: string) {
  tabs.value.forEach((tab) => {
    if (tab.kind === 'sql' && tab.connectionId === connectionId) repairSqlTabContext(tab)
    if (tab.kind === 'data' && tab.connectionId === connectionId && !findTable(tab.connectionId, tab.catalogName, tab.tableId, tab.schemaName)) {
      tab.error = 'Table no longer exists in the refreshed local tree'
      tab.rows = []
      tab.rowCount = 0
      tab.total = 0
      tab.dirtyState = makeDirtyState([], tab.primaryKey)
      tab.undoStack = []
      resetDataMutationPlan(tab)
    }
  })
}

function applySqlTabConnectionContext(tab: Extract<WorkspaceTab, { kind: 'sql' }>, connection: DatabaseConnectionInfo) {
  const catalog = connection.catalogs[0]
  tab.connectionId = connection.id
  tab.catalogName = catalog?.name ?? ''
  tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
  tab.tableId = undefined
  tab.tableName = undefined
}

async function updateSqlTabConnection(event: Event) {
  const tab = activeSqlTab.value
  if (!tab) return
  const connectionId = (event.target as HTMLSelectElement).value
  let connection = findConnection(connectionId)
  if (!connection) {
    tab.connectionId = ''
    tab.catalogName = ''
    tab.schemaName = ''
    return
  }
  if (connection.status !== 'connected' && connection.status !== 'testing') {
    const requestedConnectionId = connection.id
    const result = await connectDatabaseConnectionViaBackend(requestedConnectionId)
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database connection failed.',
        (value): value is NonNullable<DatabaseConnectionMutationResult['data']> =>
          isDatabaseConnectionMutationDataForRequest(value, { connectionId: requestedConnectionId, status: 'connected' }),
        DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    connection = findConnection(connectionId)
    if (!connection) return
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
    showNotice('Connection auto-connected for SQL context')
  }
  applySqlTabConnectionContext(tab, connection)
}

function updateSqlTabCatalog(event: Event) {
  const tab = activeSqlTab.value
  if (!tab) return
  const catalogName = (event.target as HTMLSelectElement).value
  const connection = findConnection(tab.connectionId)
  const catalog = connection?.catalogs.find((item) => item.name === catalogName)
  tab.catalogName = catalog?.name ?? catalogName
  tab.schemaName = defaultSchemaForSqlConnection(connection, catalog)
  tab.tableId = undefined
  tab.tableName = undefined
}

function updateSqlTabSchema(event: Event) {
  const tab = activeSqlTab.value
  if (!tab) return
  tab.schemaName = (event.target as HTMLSelectElement).value
  tab.tableId = undefined
  tab.tableName = undefined
}

function renderCreateDatabaseTemplate(
  name: string,
  dbType: Extract<DatabaseEngineCode, 'mysql' | 'mariadb' | 'oceanbase' | 'postgresql' | 'kingbase' | 'sqlserver' | 'clickhouse'>
) {
  const trimmed = name.trim()
  return trimmed ? `CREATE DATABASE ${quoteIdentForDialect(trimmed, dbType)};` : ''
}

function syncCreateDatabaseTemplate() {
  if (createDatabaseModal.userEditedSql) return
  const next = renderCreateDatabaseTemplate(createDatabaseModal.name, createDatabaseModal.dbType)
  createDatabaseModal.lastAppliedTemplate = next
  createDatabaseModal.sql = next
}

function updateCreateDatabaseName(event: Event) {
  createDatabaseModal.name = (event.target as HTMLInputElement).value
  createDatabaseModal.feedback = ''
  syncCreateDatabaseTemplate()
}

const createDatabaseSql = computed({
  get() {
    return createDatabaseModal.sql
  },
  set(value: string) {
    if (value !== createDatabaseModal.lastAppliedTemplate) createDatabaseModal.userEditedSql = true
    createDatabaseModal.sql = value
  }
})

const createDatabaseNameError = computed(() => {
  const name = createDatabaseModal.name.trim()
  return createDatabaseModal.open && name.length > 0 && !DB_IDENT_RE.test(name)
})

const createDatabaseCanSubmit = computed(() => {
  if (!createDatabaseModal.open || createDatabaseModal.submitting) return false
  return DB_IDENT_RE.test(createDatabaseModal.name.trim()) && createDatabaseModal.sql.trim().length > 0
})

watch(
  () => activeSqlTab.value && [activeSqlTab.value.connectionId, activeSqlTab.value.catalogName].join('|'),
  () => {
    const tab = activeSqlTab.value
    if (tab) repairSqlTabContext(tab)
  }
)

watch(
  [() => connectionDraft.dbType, databaseSshProxyNames],
  () => {
    if (connectionDraft.dbType === 'sqlite') {
      connectionDraft.needProxy = false
      connectionDraft.proxyName = ''
      return
    }
    if (connectionDraft.proxyName && !databaseSshProxyNames.value.has(connectionDraft.proxyName)) {
      connectionDraft.proxyName = ''
    }
  }
)

watch(activeTabId, (tabId) => {
  scrollActiveWorkspaceTabIntoView(tabId)
  if (dbAiPaneOpen.value && !dbAiPaneContextTouched) applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
})

function connectionsByGroup(groupId: string) {
  const needle = keyword.value.trim().toLowerCase()
  const list = connections.value.filter((connection) => connection.groupId === groupId)
  if (!needle) return list
  return list.filter((connection) => connectionText(connection).includes(needle))
}

function flattenVisibleGroups(sourceGroups: DatabaseGroupInfo[]): VisibleGroupNode[] {
  const sourceIds = new Set(sourceGroups.map((group) => group.id))
  const byParent = new Map<string | null, DatabaseGroupInfo[]>()
  sourceGroups.forEach((group) => {
    const parentId = groupParentById[group.id] ?? null
    const visibleParent = parentId && sourceIds.has(parentId) ? parentId : null
    const list = byParent.get(visibleParent) ?? []
    list.push(group)
    byParent.set(visibleParent, list)
  })
  const out: VisibleGroupNode[] = []
  const visit = (parentId: string | null, depth: number) => {
    ;(byParent.get(parentId) ?? []).forEach((group) => {
      out.push({ ...group, depth })
      visit(group.id, depth + 1)
    })
  }
  visit(null, 0)
  return out
}

function groupPathLabel(groupId: string) {
  const seen = new Set<string>()
  const names: string[] = []
  let currentId: string | null = groupId
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const group = groups.value.find((item) => item.id === currentId)
    if (!group) break
    names.unshift(group.name)
    currentId = groupParentById[currentId] ?? null
  }
  return names.join(' / ') || 'Root Group'
}

function collectDescendantGroupIds(groupId: string) {
  const out = new Set<string>()
  const visit = (parentId: string) => {
    groups.value.forEach((group) => {
      if ((groupParentById[group.id] ?? null) === parentId) {
        out.add(group.id)
        visit(group.id)
      }
    })
  }
  visit(groupId)
  return out
}

function connectionText(connection: DatabaseConnectionInfo) {
  return [connection.name, connection.dbType, connection.host, connection.database, ...connection.catalogs.map((catalog) => catalog.name)].join(' ').toLowerCase()
}

function selectNode(id: string) {
  selectedNodeId.value = id
}

function toggleGroup(id: string) {
  expandedGroups.value = toggleId(expandedGroups.value, id)
}

function toggleConnection(id: string) {
  expandedConnections.value = toggleId(expandedConnections.value, id)
}

function toggleCatalog(connectionId: string, catalogName: string) {
  expandedCatalogs.value = toggleId(expandedCatalogs.value, `${connectionId}:${catalogName}`)
}

function toggleSchema(connectionId: string, catalogName: string, schemaName: string) {
  expandedSchemas.value = toggleId(expandedSchemas.value, `${connectionId}:${catalogName}:${schemaName}`)
}

function toggleSchemaObjectFolder(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind) {
  expandedSchemaObjectFolders.value = toggleId(expandedSchemaObjectFolders.value, schemaObjectFolderKey(connectionId, catalogName, schemaName, kind))
}

function toggleTable(tableId: string) {
  expandedTables.value = toggleId(expandedTables.value, tableId)
}

function isCatalogExpanded(connectionId: string, catalogName: string) {
  return expandedCatalogs.value.includes(`${connectionId}:${catalogName}`)
}

function isSchemaExpanded(connectionId: string, catalogName: string, schemaName: string) {
  return expandedSchemas.value.includes(`${connectionId}:${catalogName}:${schemaName}`)
}

function isSchemaObjectFolderExpanded(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind) {
  return expandedSchemaObjectFolders.value.includes(schemaObjectFolderKey(connectionId, catalogName, schemaName, kind))
}

function isTableExpanded(tableId: string) {
  return expandedTables.value.includes(tableId)
}

function toggleId(list: string[], id: string) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
}

function registerWorkspaceTabRef(tabId: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) workspaceTabRefs.set(tabId, el)
  else workspaceTabRefs.delete(tabId)
}

function scrollActiveWorkspaceTabIntoView(tabId: string) {
  void nextTick(() => {
    const tabEl = workspaceTabRefs.get(tabId)
    if (typeof tabEl?.scrollIntoView === 'function') {
      tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
}

function columnNodeId(tableId: string, columnName: string) {
  return `${tableId}:column:${columnName}`
}

function schemaObjectFolderKey(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind) {
  return `${connectionId}:${catalogName}:${schemaName}:${kind}`
}

function schemaRoutineNodeId(connectionId: string, catalogName: string, schemaName: string, kind: SchemaObjectKind, routine: string) {
  return `${schemaObjectFolderKey(connectionId, catalogName, schemaName, kind)}:${routine}`
}

function schemaObjectFolders(schema: { tables: DatabaseTableInfo[]; views?: DatabaseTableInfo[]; functions?: string[]; procedures?: string[] }): SchemaObjectFolder[] {
  return [
    { kind: 'tables', count: schema.tables.length, tables: schema.tables, routines: [] },
    { kind: 'views', count: schema.views?.length ?? 0, tables: schema.views ?? [], routines: [] },
    { kind: 'functions', count: schema.functions?.length ?? 0, tables: [], routines: schema.functions ?? [] },
    { kind: 'procedures', count: schema.procedures?.length ?? 0, tables: [], routines: schema.procedures ?? [] }
  ]
}

function selectColumnNode(table: DatabaseTableInfo, column: DatabaseColumnInfo) {
  selectedNodeId.value = columnNodeId(table.id, column.name)
}

function findConnection(id: string) {
  return connections.value.find((connection) => connection.id === id)
}

function replaceRecord<T>(target: Record<string, T>, next: Record<string, T>) {
  Object.keys(target).forEach((key) => {
    delete target[key]
  })
  Object.assign(target, next)
}

function cloneDatabaseCatalog<T>(value: T): T {
  return structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isDatabaseRows(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(isRecord)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function isLocalFileWriteData(value: unknown, expectedPath: string, expectedContent: string): value is NonNullable<LocalFileWriteResult['data']> {
  return (
    isRecord(value) &&
    value.filePath === expectedPath &&
    typeof value.bytes === 'number' &&
    Number.isInteger(value.bytes) &&
    value.bytes >= 0 &&
    value.bytes === utf8ByteLength(expectedContent)
  )
}

function isDbAiStatus(value: unknown): value is DbAiStatus {
  return value === 'queued' || value === 'streaming' || value === 'done' || value === 'error' || value === 'cancelled'
}

function isDbAiAction(value: unknown): value is DbAiAction {
  return typeof value === 'string' && DB_AI_ACTIONS.includes(value as DbAiAction)
}

function isDbAiTargetDialect(value: unknown): value is DbAiTargetDialect {
  return typeof value === 'string' && DB_AI_TARGET_DIALECTS.includes(value as DbAiTargetDialect)
}

function isDatabaseEngineCode(value: unknown): value is DatabaseEngineCode {
  return typeof value === 'string' && DB_ENGINE_CODES.includes(value as DatabaseEngineCode)
}

function isDatabaseEngineOptionCode(value: unknown): value is DatabaseEngineInfo['code'] {
  return typeof value === 'string' && (DB_ENGINE_OPTION_CODES as readonly string[]).includes(value)
}

function isDatabaseEngineInfo(value: unknown): value is DatabaseEngineInfo {
  return (
    isRecord(value) &&
    isDatabaseEngineOptionCode(value.code) &&
    (value.connectionCode === undefined || isDatabaseEngineCode(value.connectionCode)) &&
    typeof value.name === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.accent === 'string'
  )
}

function isConnectableDatabaseEngineInfo(value: DatabaseEngineInfo): value is DatabaseEngineInfo & { connectionCode: DatabaseEngineCode } {
  return value.enabled && isDatabaseEngineCode(value.connectionCode)
}

function isDatabaseColumnInfo(value: unknown): value is DatabaseColumnInfo {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.nullable === 'boolean' &&
    (value.key === undefined || value.key === 'PK' || value.key === 'FK')
  )
}

function isDatabaseTableInfo(value: unknown): value is DatabaseTableInfo {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.columns) &&
    value.columns.every(isDatabaseColumnInfo) &&
    isStringArray(value.primaryKey)
  )
}

function isDatabaseSchemaInfo(value: unknown): value is { name: string; tables: DatabaseTableInfo[]; views?: DatabaseTableInfo[]; functions?: string[]; procedures?: string[] } {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.tables) &&
    value.tables.every(isDatabaseTableInfo) &&
    (value.views === undefined || (Array.isArray(value.views) && value.views.every(isDatabaseTableInfo))) &&
    (value.functions === undefined || isStringArray(value.functions)) &&
    (value.procedures === undefined || isStringArray(value.procedures))
  )
}

function isDatabaseCatalogInfo(value: unknown): value is DatabaseCatalogInfo {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.schemas === undefined || (Array.isArray(value.schemas) && value.schemas.every(isDatabaseSchemaInfo))) &&
    (value.tables === undefined || (Array.isArray(value.tables) && value.tables.every(isDatabaseTableInfo)))
  )
}

function isDatabaseConnectionEnv(value: unknown): value is DatabaseConnectionInfo['env'] {
  return value === 'Development' || value === 'TEST' || value === 'Staging' || value === 'Production'
}

function isDatabaseConnectionStatus(value: unknown): value is DatabaseConnectionInfo['status'] {
  return value === 'idle' || value === 'testing' || value === 'connected' || value === 'failed'
}

function isDatabaseConnectionInfo(value: unknown): value is DatabaseConnectionInfo {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isDatabaseEngineCode(value.dbType) &&
    isDatabaseConnectionEnv(value.env) &&
    typeof value.groupId === 'string' &&
    typeof value.host === 'string' &&
    (value.port === null || (typeof value.port === 'number' && Number.isFinite(value.port))) &&
    value.authentication === 'UserAndPassword' &&
    typeof value.user === 'string' &&
    (value.hasPassword === undefined || typeof value.hasPassword === 'boolean') &&
    typeof value.database === 'string' &&
    (value.filePath === undefined || typeof value.filePath === 'string') &&
    (value.readonly === undefined || typeof value.readonly === 'boolean') &&
    (value.sslMode === undefined ||
      value.sslMode === '' ||
      value.sslMode === 'disable' ||
      value.sslMode === 'require' ||
      value.sslMode === 'verify-ca' ||
      value.sslMode === 'verify-full') &&
    (value.needProxy === undefined || typeof value.needProxy === 'boolean') &&
    (value.proxyName === undefined || typeof value.proxyName === 'string') &&
    (value.url === undefined || typeof value.url === 'string') &&
    isDatabaseConnectionStatus(value.status) &&
    Array.isArray(value.catalogs) &&
    value.catalogs.every(isDatabaseCatalogInfo)
  )
}

function isDatabaseGroupInfo(value: unknown): value is DatabaseGroupInfo {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

function isStringNullRecord(value: unknown): value is Record<string, string | null> {
  return isRecord(value) && Object.values(value).every((item) => item === null || typeof item === 'string')
}

function isDatabaseCatalogDefaults(value: unknown): value is DatabaseWorkspaceCatalog['defaults'] {
  return (
    isRecord(value) &&
    (value.selectedNodeId === null || typeof value.selectedNodeId === 'string') &&
    isStringArray(value.expandedGroupIds) &&
    isStringArray(value.expandedConnectionIds) &&
    isStringArray(value.expandedCatalogIds) &&
    isStringArray(value.expandedSchemaIds) &&
    isStringArray(value.expandedSchemaObjectFolderIds)
  )
}

function isDatabaseWorkspaceCatalog(value: unknown): value is DatabaseWorkspaceCatalog {
  return (
    isRecord(value) &&
    Array.isArray(value.engines) &&
    value.engines.every(isDatabaseEngineInfo) &&
    Array.isArray(value.groups) &&
    value.groups.every(isDatabaseGroupInfo) &&
    isStringNullRecord(value.groupParents) &&
    Array.isArray(value.connections) &&
    value.connections.every(isDatabaseConnectionInfo) &&
    isDatabaseCatalogDefaults(value.defaults)
  )
}

function isDatabaseConnectionTestData(value: unknown): value is NonNullable<DatabaseConnectionTestResult['data']> {
  return (
    isRecord(value) &&
    isDatabaseEngineCode(value.dbType) &&
    typeof value.serverVersion === 'string' &&
    typeof value.endpoint === 'string' &&
    isNonNegativeNumber(value.durationMs)
  )
}

function isDatabaseConnectionSaveData(value: unknown): value is NonNullable<DatabaseConnectionSaveResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseConnectionInfo(record.connection) && typeof record.message === 'string'
}

const databaseRequestText = (value: unknown) => String(value ?? '').trim()

function isDatabaseConnectionSaveDataForRequest(value: unknown, input: DatabaseConnectionSaveInput): value is NonNullable<DatabaseConnectionSaveResult['data']> {
  if (!isDatabaseConnectionSaveData(value)) return false
  const saved = value.connection
  if (input.mode === 'edit' && input.id && saved.id !== input.id) return false
  const expected = input.connection
  const expectedProxyName = expected.dbType !== 'sqlite' && expected.needProxy ? databaseRequestText(expected.proxyName) : ''
  return (
    saved.name === databaseRequestText(expected.name) &&
    saved.dbType === expected.dbType &&
    saved.env === (expected.env || 'Development') &&
    saved.groupId === expected.groupId &&
    saved.authentication === (expected.authentication || 'UserAndPassword') &&
    (expected.dbType === 'sqlite' || saved.user === databaseRequestText(expected.user)) &&
    (expected.dbType !== 'sqlite' || (saved.filePath || '') === databaseRequestText(expected.filePath)) &&
    Boolean(saved.readonly) === Boolean(expected.readonly) &&
    (saved.sslMode || '') === (expected.sslMode || '') &&
    Boolean(saved.needProxy) === Boolean(expectedProxyName) &&
    (saved.proxyName || '') === expectedProxyName &&
    value.connections.some((connection) => connection.id === saved.id)
  )
}

function isDatabaseGroupMutationData(value: unknown): value is NonNullable<DatabaseGroupMutationResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseGroupInfo(record.group) && typeof record.message === 'string'
}

function isDatabaseGroupMutationDataForRequest(
  value: unknown,
  options: { id?: string; parentId?: string | null; name?: string }
): value is NonNullable<DatabaseGroupMutationResult['data']> {
  if (!isDatabaseGroupMutationData(value)) return false
  if (options.id && value.group.id !== options.id) return false
  if (options.name !== undefined && value.group.name !== options.name) return false
  if (options.parentId !== undefined && (value.groupParents[value.group.id] ?? null) !== options.parentId) return false
  return value.groups.some((group) => group.id === value.group.id)
}

function isDatabaseGroupDeleteData(value: unknown): value is NonNullable<DatabaseGroupDeleteResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return typeof record.deletedGroupId === 'string' && typeof record.message === 'string'
}

function isDatabaseGroupDeleteDataForRequest(value: unknown, deletedGroupId: string): value is NonNullable<DatabaseGroupDeleteResult['data']> {
  return isDatabaseGroupDeleteData(value) && value.deletedGroupId === deletedGroupId && !value.groups.some((group) => group.id === deletedGroupId)
}

function isDatabaseConnectionMutationData(value: unknown): value is NonNullable<DatabaseConnectionMutationResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseConnectionInfo(record.connection) && typeof record.message === 'string'
}

function isDatabaseConnectionMutationDataForRequest(
  value: unknown,
  options: { connectionId: string; groupId?: string; status?: DatabaseConnectionInfo['status'] }
): value is NonNullable<DatabaseConnectionMutationResult['data']> {
  if (!isDatabaseConnectionMutationData(value)) return false
  if (value.connection.id !== options.connectionId) return false
  if (options.groupId !== undefined && value.connection.groupId !== options.groupId) return false
  if (options.status !== undefined && value.connection.status !== options.status) return false
  return value.connections.some((connection) => connection.id === options.connectionId)
}

function isDatabaseConnectionDeleteData(value: unknown): value is NonNullable<DatabaseConnectionDeleteResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return typeof record.connectionId === 'string' && typeof record.message === 'string'
}

function isDatabaseConnectionDeleteDataForRequest(value: unknown, connectionId: string): value is NonNullable<DatabaseConnectionDeleteResult['data']> {
  return isDatabaseConnectionDeleteData(value) && value.connectionId === connectionId && !value.connections.some((connection) => connection.id === connectionId)
}

function isDatabaseCreateDatabaseData(value: unknown): value is NonNullable<DatabaseCreateDatabaseResult['data']> {
  if (!isRecord(value) || !isDatabaseWorkspaceCatalog(value)) return false
  const record: Record<string, unknown> = value
  return isDatabaseConnectionInfo(record.connection) && isDatabaseCatalogInfo(record.catalog) && typeof record.message === 'string'
}

function isDatabaseCreateDatabaseDataForRequest(
  value: unknown,
  connectionId: string,
  requestedName: string
): value is NonNullable<DatabaseCreateDatabaseResult['data']> {
  return (
    isDatabaseCreateDatabaseData(value) &&
    value.connection.id === connectionId &&
    value.catalog.name.toLowerCase() === requestedName.toLowerCase() &&
    value.connections.some((connection) => connection.id === connectionId && connection.catalogs.some((catalog) => catalog.name.toLowerCase() === requestedName.toLowerCase()))
  )
}

function isDatabaseTableMutationData(value: unknown, options: { requireCatalog?: boolean } = {}): value is NonNullable<DatabaseTableMutationResult['data']> {
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.affected) &&
    isNonNegativeNumber(value.durationMs) &&
    (value.catalog === undefined ? !options.requireCatalog : isDatabaseWorkspaceCatalog(value.catalog))
  )
}

function isDatabaseTableMutationPlanStatement(value: unknown): value is NonNullable<DatabaseTableMutationPlanResult['data']>['statements'][number] {
  return (
    isRecord(value) &&
    (value.kind === 'delete' || value.kind === 'update' || value.kind === 'insert' || value.kind === 'truncate' || value.kind === 'drop') &&
    typeof value.sql === 'string' &&
    Array.isArray(value.params) &&
    typeof value.preview === 'string'
  )
}

function isDatabaseTableMutationPlanData(value: unknown): value is NonNullable<DatabaseTableMutationPlanResult['data']> {
  return (
    isRecord(value) &&
    Array.isArray(value.statements) &&
    value.statements.every(isDatabaseTableMutationPlanStatement) &&
    isNonNegativeNumber(value.statementCount) &&
    typeof value.preview === 'string' &&
    typeof value.warning === 'string'
  )
}

function isDbAiBackendContext(value: unknown): value is DbAiBackendContext {
  if (!isRecord(value)) return false
  if (value.connectionId !== undefined && typeof value.connectionId !== 'string') return false
  if (value.dbType !== undefined && value.dbType !== '' && !isDatabaseEngineCode(value.dbType)) return false
  if (value.databaseName !== undefined && typeof value.databaseName !== 'string') return false
  if (value.schemaName !== undefined && typeof value.schemaName !== 'string') return false
  if (value.tableName !== undefined && typeof value.tableName !== 'string') return false
  if (value.contextSummary !== undefined && typeof value.contextSummary !== 'string') return false
  return true
}

function isDbAiPaneMessageRecord(value: unknown, expected?: { role?: 'user' | 'assistant'; requestId?: string; id?: string }): value is DbAiPaneMessage {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (typeof value.requestId !== 'string' || !value.requestId.trim()) return false
  if (value.role !== 'user' && value.role !== 'assistant') return false
  if (!isDbAiStatus(value.status)) return false
  if (typeof value.content !== 'string' || typeof value.contextSummary !== 'string') return false
  if (!isNonNegativeNumber(value.createdAt) || !isNonNegativeNumber(value.updatedAt)) return false
  if (expected?.role && value.role !== expected.role) return false
  if (expected?.requestId && value.requestId !== expected.requestId) return false
  if (expected?.id && value.id !== expected.id) return false
  return true
}

function isDbAiPaneStateContext(value: unknown): value is DbAiPaneContext {
  return (
    isRecord(value) &&
    typeof value.connectionId === 'string' &&
    typeof value.catalogName === 'string' &&
    typeof value.schemaName === 'string' &&
    (value.dbType === '' || isDatabaseEngineCode(value.dbType))
  )
}

function isDbAiPaneStateSnapshot(value: unknown): value is DatabaseAiPaneStateSnapshot {
  return (
    isRecord(value) &&
    typeof value.open === 'boolean' &&
    isNonNegativeNumber(value.width) &&
    isDbAiPaneStateContext(value.context) &&
    typeof value.draft === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every((message) => isDbAiPaneMessageRecord(message))
  )
}

function isDbAiPaneRequestData(value: unknown): value is { requestId: string; userMessage: DbAiPaneMessage; assistantMessage: DbAiPaneMessage } {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !value.requestId.trim()) return false
  return (
    isDbAiPaneMessageRecord(value.userMessage, { role: 'user', requestId: value.requestId }) &&
    isDbAiPaneMessageRecord(value.assistantMessage, { role: 'assistant', requestId: value.requestId })
  )
}

function isDbAiPaneLifecycleData(value: unknown, expected: { requestId: string; assistantMessageId?: string }): value is { assistantMessage: DbAiPaneMessage } {
  return isRecord(value) && isDbAiPaneMessageRecord(value.assistantMessage, { role: 'assistant', requestId: expected.requestId, id: expected.assistantMessageId })
}

function isDbAiPaneResponseData(
  value: unknown,
  expected: { requestId: string; assistantMessageId: string }
): value is NonNullable<DatabaseAiPaneResponseResult['data']> {
  return (
    isRecord(value) &&
    value.requestId === expected.requestId &&
    isDbAiPaneMessageRecord(value.assistantMessage, { role: 'assistant', requestId: expected.requestId, id: expected.assistantMessageId }) &&
    typeof value.text === 'string' &&
    typeof value.provider === 'string' &&
    isNonNegativeNumber(value.durationMs)
  )
}

function isDbAiDrawerRequestRecord(value: unknown, expectedId?: string): value is DbAiRequest {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (expectedId && value.id !== expectedId) return false
  return (
    isDbAiAction(value.action) &&
    typeof value.label === 'string' &&
    isDbAiStatus(value.status) &&
    typeof value.contextSummary === 'string' &&
    typeof value.sourceSql === 'string' &&
    typeof value.text === 'string' &&
    isDbAiTargetDialect(value.targetDialect) &&
    isDbAiBackendContext(value.backendContext) &&
    isNonNegativeNumber(value.createdAt) &&
    isNonNegativeNumber(value.updatedAt)
  )
}

function isDbAiDrawerResponseData(value: unknown, expectedId: string): value is NonNullable<DatabaseAiDrawerResponseResult['data']> {
  return (
    isRecord(value) &&
    isDbAiDrawerRequestRecord(value.request, expectedId) &&
    typeof value.text === 'string' &&
    typeof value.reasoning === 'string' &&
    typeof value.sql === 'string' &&
    typeof value.provider === 'string' &&
    isNonNegativeNumber(value.durationMs)
  )
}

function isDatabaseSqlExecutionRecord(value: unknown): value is DatabaseSqlExecutionRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    (value.status === 'ok' || value.status === 'error') &&
    typeof value.message === 'string' &&
    value.message.trim() !== '' &&
    isNonNegativeNumber(value.durationMs) &&
    isNonNegativeNumber(value.rowCount) &&
    typeof value.createdAt === 'string' &&
    value.createdAt.trim() !== ''
  )
}

function isDatabaseSqlExecuteData(value: unknown): value is NonNullable<DatabaseSqlExecuteResult['data']> {
  return (
    isRecord(value) &&
    isStringArray(value.columns) &&
    isDatabaseRows(value.rows) &&
    isNonNegativeNumber(value.rowCount) &&
    isNonNegativeNumber(value.durationMs) &&
    isDatabaseSqlExecutionRecord(value.execution) &&
    value.execution.status === 'ok'
  )
}

function isDatabaseTableQueryData(value: unknown): value is NonNullable<DatabaseTableQueryResult['data']> {
  return (
    isRecord(value) &&
    isStringArray(value.columns) &&
    isDatabaseRows(value.rows) &&
    isNonNegativeNumber(value.rowCount) &&
    isNonNegativeNumber(value.durationMs) &&
    (value.total === null || isNonNegativeNumber(value.total)) &&
    isStringArray(value.knownColumns)
  )
}

function isDatabaseExportData(value: unknown): value is NonNullable<DatabaseExportResult['data']> {
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.exported) &&
    typeof value.fileName === 'string' &&
    value.fileName.trim().endsWith('.csv') &&
    (value.filePath === undefined || typeof value.filePath === 'string') &&
    (value.canceled === undefined || typeof value.canceled === 'boolean') &&
    (value.csv === undefined || typeof value.csv === 'string')
  )
}

function isDatabasePageCommentKey(value: unknown, expected?: DatabasePageCommentKey | null): value is DatabasePageCommentKey {
  if (!isRecord(value)) return false
  if (value.scope !== 'sql-result' && value.scope !== 'table-page') return false
  if (typeof value.connectionId !== 'string' || typeof value.databaseName !== 'string') return false
  if (value.schemaName !== undefined && typeof value.schemaName !== 'string') return false
  if (value.tableName !== undefined && typeof value.tableName !== 'string') return false
  if (value.resultId !== undefined && typeof value.resultId !== 'string') return false
  if (value.sql !== undefined && typeof value.sql !== 'string') return false
  const key: DatabasePageCommentKey = {
    scope: value.scope,
    connectionId: value.connectionId,
    databaseName: value.databaseName,
    ...(value.schemaName ? { schemaName: value.schemaName } : {}),
    ...(value.tableName ? { tableName: value.tableName } : {}),
    ...(value.resultId ? { resultId: value.resultId } : {}),
    ...(value.sql ? { sql: value.sql } : {})
  }
  if (!expected) return true
  return databasePageCommentKeyId(key) === databasePageCommentKeyId(expected)
}

function isDatabasePageCommentRecord(value: unknown, expected?: DatabasePageCommentKey | null): value is DatabasePageCommentRecord {
  if (!isRecord(value) || !isDatabasePageCommentKey(value, expected)) return false
  const record = value as Record<string, unknown>
  return typeof record.comment === 'string' && isNonNegativeNumber(record.updatedAt)
}

function isDatabasePageCommentGetData(value: unknown, expected: DatabasePageCommentKey): value is { record: DatabasePageCommentRecord } {
  return isRecord(value) && isDatabasePageCommentRecord(value.record, expected)
}

function isDatabasePageCommentSaveData(value: unknown, expected: DatabasePageCommentKey): value is { record: DatabasePageCommentRecord; message: string } {
  return isRecord(value) && isDatabasePageCommentRecord(value.record, expected) && typeof value.message === 'string'
}

function tableNodeExists(tableId: string) {
  return connections.value.some((connection) =>
    connection.catalogs.some((catalog) => {
      if (catalog.tables?.some((table) => table.id === tableId || table.columns.some((column) => columnNodeId(table.id, column.name) === tableId))) {
        return true
      }
      return (catalog.schemas ?? []).some((schema) => {
        if ([schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'tables'), schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'views'), schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'functions'), schemaObjectFolderKey(connection.id, catalog.name, schema.name, 'procedures')].includes(tableId)) {
          return true
        }
        if ([`${connection.id}:${catalog.name}`, `${connection.id}:${catalog.name}:${schema.name}`].includes(tableId)) return true
        const tableHit = [...schema.tables, ...(schema.views ?? [])].some((table) => table.id === tableId || table.columns.some((column) => columnNodeId(table.id, column.name) === tableId))
        if (tableHit) return true
        return (['functions', 'procedures'] as const).some((kind) =>
          (schema[kind] ?? []).some((routine) => tableId === schemaRoutineNodeId(connection.id, catalog.name, schema.name, kind, routine))
        )
      })
    })
  )
}

function databaseNodeExists(id: string | null) {
  if (!id) return false
  if (groups.value.some((group) => group.id === id)) return true
  if (connections.value.some((connection) => connection.id === id)) return true
  return tableNodeExists(id)
}

function applyDatabaseCatalog(catalog: DatabaseWorkspaceCatalog) {
  databaseEngines.value = cloneDatabaseCatalog(catalog.engines).filter(isConnectableDatabaseEngineInfo)
  groups.value = cloneDatabaseCatalog(catalog.groups)
  replaceRecord(groupParentById, cloneDatabaseCatalog(catalog.groupParents))
  connections.value = cloneDatabaseCatalog(catalog.connections)
  expandedGroups.value = catalog.defaults.expandedGroupIds.slice()
  expandedConnections.value = catalog.defaults.expandedConnectionIds.slice()
  expandedCatalogs.value = catalog.defaults.expandedCatalogIds.slice()
  expandedSchemas.value = catalog.defaults.expandedSchemaIds.slice()
  expandedSchemaObjectFolders.value = catalog.defaults.expandedSchemaObjectFolderIds.slice()
  selectedNodeId.value = databaseNodeExists(catalog.defaults.selectedNodeId)
    ? catalog.defaults.selectedNodeId
    : connections.value[0]?.id ?? groups.value[0]?.id ?? null
  tabs.value.forEach((tab) => {
    if (tab.kind === 'sql') repairSqlTabContext(tab)
    if (tab.kind === 'data') {
      const table = findTable(tab.connectionId, tab.catalogName, tab.tableId, tab.schemaName)
      if (!table) {
        tab.error = 'Table no longer exists in the backend catalog'
        tab.rows = []
        tab.rowCount = 0
        tab.total = 0
        tab.dirtyState = makeDirtyState([], tab.primaryKey)
        tab.undoStack = []
        resetDataMutationPlan(tab)
      }
    }
  })
  if (dbAiPaneOpen.value || dbAiPaneContext.connectionId) {
    if (dbAiPaneContext.connectionId && findConnection(dbAiPaneContext.connectionId)) {
      applyDbAiPaneContext(dbAiPaneContext, dbAiPaneContextTouched)
    } else {
      ensureDbAiPaneContextInitialized(true)
    }
  }
}

async function loadDatabaseCatalog() {
  try {
    const result = await window.aiops.listDatabaseCatalog()
    if (!result.ok) {
      showNotice(result.errorMessage || 'Database catalog backend is unavailable')
      return
    }
    if (!isDatabaseWorkspaceCatalog(result.data)) {
      showNotice(DATABASE_CATALOG_MALFORMED_MESSAGE)
      return
    }
    applyDatabaseCatalog(result.data)
  } catch (error) {
    showNotice(errorToMessage(error))
  }
}

type DatabaseCatalogMutationEnvelope = { ok: boolean; data?: unknown; errorMessage?: string }

function databaseCatalogMutationData<T extends DatabaseWorkspaceCatalog>(
  result: DatabaseCatalogMutationEnvelope,
  fallbackError: string,
  isData: (value: unknown) => value is T = isDatabaseWorkspaceCatalog as (value: unknown) => value is T,
  malformedError = DATABASE_CATALOG_MALFORMED_MESSAGE
) {
  if (!result.ok) {
    showNotice(result.errorMessage || fallbackError)
    return null
  }
  if (!isData(result.data)) {
    showNotice(malformedError)
    return null
  }
  return result.data
}

function applyDatabaseCatalogMutationResult<T extends DatabaseWorkspaceCatalog>(
  result: { ok: boolean; data?: unknown; errorMessage?: string },
  fallbackError: string,
  isData?: (value: unknown) => value is T,
  malformedError?: string
) {
  const data = databaseCatalogMutationData(result, fallbackError, isData, malformedError)
  if (!data) return false
  applyDatabaseCatalog(data)
  return true
}

function findTable(connectionId: string, catalogName: string, tableId: string, schemaName?: string) {
  const catalog = findConnection(connectionId)?.catalogs.find((item) => item.name === catalogName)
  if (!catalog) return null
  if (schemaName) {
    const schema = catalog.schemas?.find((item) => item.name === schemaName)
    return [...(schema?.tables ?? []), ...(schema?.views ?? [])].find((table) => table.id === tableId) ?? null
  }
  return catalog.tables?.find((table) => table.id === tableId) ?? null
}

function tableByName(connection: DatabaseConnectionInfo | undefined, catalogName: string, schemaName: string | undefined, tableName: string) {
  const catalog = connection?.catalogs.find((item) => item.name === catalogName)
  if (!catalog) return null
  const normalized = tableName.replace(/[`";]/g, '').split('.').pop()?.trim().toLowerCase()
  if (!normalized) return null
  const schema = schemaName ? catalog.schemas?.find((item) => item.name === schemaName) : undefined
  const tables = schemaName ? [...(schema?.tables ?? []), ...(schema?.views ?? [])] : catalog.tables
  return tables?.find((table) => table.name.toLowerCase() === normalized) ?? null
}

function tableContextMatches(
  tab: Extract<WorkspaceTab, { kind: 'sql' | 'data' }>,
  ctx: { connectionId: string; catalogName: string; schemaName?: string; tableId?: string; tableName: string }
) {
  if (tab.connectionId !== ctx.connectionId || tab.catalogName !== ctx.catalogName) return false
  if ((tab.schemaName || '') !== (ctx.schemaName || '')) return false
  if (tab.kind === 'data') return tab.tableId === ctx.tableId || tab.tableName === ctx.tableName
  return tab.tableId === ctx.tableId || tab.tableName === ctx.tableName
}

function getOrCreateSqlResultViewState(resultId: string): SqlResultViewState {
  let state = sqlResultViewStateById[resultId]
  if (!state) {
    state = { page: 1, pageSize: 100, filters: [], sort: null }
    sqlResultViewStateById[resultId] = state
  }
  return state
}

async function openTable(connectionId: string, catalogName: string, table: DatabaseTableInfo, schemaName?: string) {
  const existing = tabs.value.find((tab) => tab.kind === 'data' && tab.tableId === table.id && tab.connectionId === connectionId) as WorkspaceTab | undefined
  if (existing) {
    activeTabId.value = existing.id
    return
  }
  const tab: WorkspaceTab = {
    id: `tab-data-${table.id}-${Date.now()}`,
    kind: 'data',
    title: table.name,
    connectionId,
    catalogName,
    schemaName,
    tableId: table.id,
    tableName: table.name,
    columns: table.columns.map((column) => column.name),
    sourceRows: [],
    rows: [],
    primaryKey: table.primaryKey,
    whereRaw: '',
    whereDraft: '',
    orderByRaw: '',
    orderByDraft: '',
    page: 1,
    pageSize: 100,
    filters: [],
    sort: null,
    selectedRowKey: null,
    loading: true,
    error: null,
    total: null,
    rowCount: 0,
    knownColumns: table.columns.map((column) => column.name),
    durationMs: 0,
    dirtyState: makeDirtyState([], table.primaryKey),
    undoStack: [],
    mutationPlan: makeDataMutationPlanState(),
    saving: false,
    saveError: null
  }
  tabs.value.push(tab)
  activeTabId.value = tab.id
  await nextTick()
  const reactiveTab = tabs.value.find((item) => item.id === tab.id && item.kind === 'data') as Extract<WorkspaceTab, { kind: 'data' }> | undefined
  if (reactiveTab) await reloadDataTab(reactiveTab, { preserveDirty: false })
}

function closeTab(tabId: string) {
  const index = tabs.value.findIndex((tab) => tab.id === tabId)
  if (index <= 0) return
  tabs.value.splice(index, 1)
  if (activeTabId.value === tabId) activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id ?? 'tab-overview'
}

function selectOverflowTab(tabId: string) {
  activeTabId.value = tabId
  scrollActiveWorkspaceTabIntoView(tabId)
  overflowOpen.value = false
}

function nextQueryTitle() {
  const indexes = tabs.value
    .filter((tab) => tab.kind === 'sql')
    .map((tab) => /^Query (\d+)$/.exec(tab.title)?.[1])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
  return `Query ${indexes.length ? Math.max(...indexes) + 1 : 1}`
}

function resolveSqlConsoleContext(explicitConnectionId?: string): SqlConsoleContext {
  const explicitConnection = explicitConnectionId ? findConnection(explicitConnectionId) : null
  if (explicitConnection) return defaultSqlContextForConnection(explicitConnection)

  const active = activeTab.value
  if (active?.kind === 'sql' || active?.kind === 'data') {
    const connection = findConnection(active.connectionId)
    if (connection) {
      const catalogName = active.catalogName || connection.catalogs[0]?.name || ''
      const catalog = connection.catalogs.find((item) => item.name === catalogName) ?? connection.catalogs[0]
      const schemaName =
        active.kind === 'sql'
          ? active.schemaName || pickDefaultSchemaName(catalog)
          : active.schemaName || pickDefaultSchemaName(catalog)
      const context = { connectionId: connection.id, catalogName: catalog?.name ?? catalogName, schemaName: schemaName ?? '' }
      if (isSqlConsoleContextReady(context)) return context
    }
  }

  const selected = resolveSelectedSqlContext()
  if (selected && isSqlConsoleContextReady(selected)) return selected
  return firstReadySqlConsoleContext() ?? selected ?? (connections.value[0] ? defaultSqlContextForConnection(connections.value[0]) : { connectionId: '', catalogName: '', schemaName: '' })
}

function isSqlConsoleContextReady(context: SqlConsoleContext | { connectionId: string; catalogName: string; schemaName: string }) {
  const connection = findConnection(context.connectionId)
  if (!connection || !context.catalogName) return false
  const catalog = connection.catalogs.find((item) => item.name === context.catalogName)
  if (!catalog) return false
  if (sqlConnectionRequiresSchema(connection)) return !!context.schemaName && !!catalog.schemas?.some((schema) => schema.name === context.schemaName)
  return true
}

function firstReadySqlConsoleContext(): SqlConsoleContext | null {
  for (const connection of connections.value) {
    const context = defaultSqlContextForConnection(connection)
    if (isSqlConsoleContextReady(context)) return context
  }
  return null
}

function defaultSqlContextForConnection(connection: DatabaseConnectionInfo): SqlConsoleContext {
  const catalog = connection.catalogs[0]
  return {
    connectionId: connection.id,
    catalogName: catalog?.name ?? '',
    schemaName: defaultSchemaForSqlConnection(connection, catalog)
  }
}

function pickDefaultSchemaName(catalog: DatabaseCatalogInfo | undefined) {
  if (!catalog?.schemas?.length) return ''
  return catalog.schemas.find((schema) => schema.name === 'public')?.name ?? catalog.schemas[0]?.name ?? ''
}

function resolveSelectedSqlContext(): SqlConsoleContext | null {
  const selectedId = selectedNodeId.value
  if (!selectedId) return null
  const connection = findConnection(selectedId)
  if (connection) return defaultSqlContextForConnection(connection)
  for (const item of connections.value) {
    for (const catalog of item.catalogs) {
      if (`${item.id}:${catalog.name}` === selectedId) {
        return { connectionId: item.id, catalogName: catalog.name, schemaName: pickDefaultSchemaName(catalog) ?? '' }
      }
      for (const schema of catalog.schemas ?? []) {
        if (`${item.id}:${catalog.name}:${schema.name}` === selectedId) {
          return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
        }
        for (const kind of ['tables', 'views', 'functions', 'procedures'] as const) {
          if (selectedId === schemaObjectFolderKey(item.id, catalog.name, schema.name, kind)) {
            return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
          }
        }
        const selectedTable = [...schema.tables, ...(schema.views ?? [])].find(
          (table) => table.id === selectedId || table.columns.some((column) => columnNodeId(table.id, column.name) === selectedId)
        )
        if (selectedTable) return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
        const selectedRoutine = (['functions', 'procedures'] as const).some((kind) =>
          (schema[kind] ?? []).some((routine) => selectedId === schemaRoutineNodeId(item.id, catalog.name, schema.name, kind, routine))
        )
        if (selectedRoutine) return { connectionId: item.id, catalogName: catalog.name, schemaName: schema.name }
      }
      const selectedCatalogTable = catalog.tables?.find(
        (table) => table.id === selectedId || table.columns.some((column) => columnNodeId(table.id, column.name) === selectedId)
      )
      if (selectedCatalogTable) return { connectionId: item.id, catalogName: catalog.name, schemaName: '' }
    }
  }
  return null
}

function normalizeDbAiPaneContext(input: Partial<DbAiPaneContext> | SqlConsoleContext): DbAiPaneContext {
  const connection = input.connectionId ? (findConnection(input.connectionId) ?? connections.value[0]) : connections.value[0]
  if (!connection) return { connectionId: '', catalogName: '', schemaName: '', dbType: '' }
  const catalog = connection.catalogs.find((item) => item.name === input.catalogName) ?? connection.catalogs[0]
  const schemaName = sqlConnectionRequiresSchema(connection) ? defaultSchemaForSqlConnection(connection, catalog) : ''
  const requestedSchema = sqlConnectionRequiresSchema(connection)
    ? catalog?.schemas?.find((schema) => schema.name === input.schemaName)?.name
    : ''
  return {
    connectionId: connection.id,
    catalogName: catalog?.name ?? '',
    schemaName: requestedSchema || schemaName,
    dbType: connection.dbType
  }
}

function applyDbAiPaneContext(input: Partial<DbAiPaneContext> | SqlConsoleContext, touched = true) {
  const next = normalizeDbAiPaneContext(input)
  dbAiPaneContext.connectionId = next.connectionId
  dbAiPaneContext.catalogName = next.catalogName
  dbAiPaneContext.schemaName = next.schemaName
  dbAiPaneContext.dbType = next.dbType
  dbAiPaneContextTouched = touched
}

function resolveDbAiPaneContextFromWorkspace() {
  return normalizeDbAiPaneContext(resolveSqlConsoleContext())
}

function ensureDbAiPaneContextInitialized(force = false) {
  if (!force && dbAiPaneContext.connectionId && findConnection(dbAiPaneContext.connectionId)) {
    applyDbAiPaneContext(dbAiPaneContext, dbAiPaneContextTouched)
    return
  }
  applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
}

function toggleDbAiPane() {
  if (dbAiPaneOpen.value) closeDbAiPane()
  else openDbAiPane()
}

function openDbAiPane() {
  if (!canToggleDbAiPane.value) return
  ensureDbAiPaneContextInitialized(false)
  dbAiPaneOpen.value = true
  scrollDbAiPaneMessagesToBottom()
}

function closeDbAiPane() {
  dbAiPaneOpen.value = false
}

function useActiveDbAiPaneContext() {
  applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
  showNotice('DB AI context synced with active workspace tab')
}

function updateDbAiPaneConnection(event: Event) {
  const connectionId = (event.target as HTMLSelectElement).value
  const connection = findConnection(connectionId)
  if (!connection) return
  applyDbAiPaneContext(defaultSqlContextForConnection(connection), true)
}

function updateDbAiPaneCatalog(event: Event) {
  const catalogName = (event.target as HTMLSelectElement).value
  applyDbAiPaneContext({ ...dbAiPaneContext, catalogName, schemaName: '' }, true)
}

function updateDbAiPaneSchema(event: Event) {
  dbAiPaneContext.schemaName = (event.target as HTMLSelectElement).value
  dbAiPaneContextTouched = true
}

async function connectDbAiPaneConnection() {
  const connection = dbAiPaneConnection.value
  if (!connection) return
  const result = await connectDatabaseConnectionViaBackend(connection.id)
  if (
    !applyDatabaseCatalogMutationResult(
      result,
      'Database connection failed.',
      (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId: connection.id, status: 'connected' }),
      DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
    )
  ) {
    return
  }
  expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
  showNotice('DB AI context connection opened')
}

function handleDbAiPaneDraftKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (event.shiftKey) return
  event.preventDefault()
  sendDbAiPaneMessage()
}

function sendDbAiPaneQuickPrompt(kind: DbAiPaneQuickPrompt) {
  if (dbAiPaneIsStreaming.value) return
  if (kind === 'explainActive') {
    const tab = activeSqlTab.value
    if (!tab) return
    const sql = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim() || tab.sql.trim()
    sendDbAiPaneMessage(`Explain this SQL and point out execution risks:\n${sql}`)
    return
  }
  if (kind === 'schemaSummary') {
    sendDbAiPaneMessage('Summarize the current database schema and list useful query entry points.')
    return
  }
  sendDbAiPaneMessage('Generate a read-only SELECT query for the most useful table in the current context.')
}

async function sendDbAiPaneMessage(promptOverride = '') {
  const prompt = (promptOverride || dbAiPaneDraft.value).trim()
  if (!prompt || dbAiPaneIsStreaming.value) return
  ensureDbAiPaneContextInitialized(false)
  if (!dbAiPaneContext.connectionId || !dbAiPaneContext.catalogName) {
    showNotice('Database context is required before using DB AI pane')
    return
  }
  if (dbAiPaneConnectionNeedsConnect.value) {
    await connectDbAiPaneConnection()
    if (dbAiPaneConnectionNeedsConnect.value) return
  }
  const contextSummary = dbAiPaneContextSummary.value
  const requestInput = {
    prompt,
    context: {
      connectionId: dbAiPaneContext.connectionId,
      dbType: dbAiPaneContext.dbType || undefined,
      databaseName: dbAiPaneContext.catalogName,
      schemaName: dbAiPaneContext.schemaName,
      contextSummary
    },
    activeSql: activeSqlTab.value?.sql ?? '',
    messages: dbAiPaneMessages.value.slice(-12).map((message) => ({ role: message.role, content: message.content }))
  }
  const createBridge = window.aiops?.createDatabaseAiPaneRequest
  if (typeof createBridge !== 'function') {
    showNotice('DB AI pane request service unavailable')
    return
  }
  let created: DatabaseAiPaneRequestResult
  try {
    created = await createBridge(requestInput)
  } catch (error) {
    showNotice(bridgeErrorMessage(error, 'DB AI pane request failed'))
    return
  }
  if (!created.ok) {
    showNotice(created.errorMessage || 'DB AI pane request failed')
    return
  }
  if (!isDbAiPaneRequestData(created.data)) {
    showNotice('DB AI pane backend returned malformed request data.')
    return
  }
  const { userMessage, assistantMessage } = created.data
  dbAiPaneMessages.value = [...dbAiPaneMessages.value, userMessage, assistantMessage]
  if (!promptOverride) dbAiPaneDraft.value = ''
  void requestDbAiPaneResponse(assistantMessage.id, prompt, { ...dbAiPaneContext }, contextSummary, created.data.requestId)
  scrollDbAiPaneMessagesToBottom()
}

async function requestDbAiPaneResponse(messageId: string, prompt: string, context: DbAiPaneContext, contextSummary: string, requestId: string) {
  const startBridge = window.aiops?.startDatabaseAiPaneResponse
  if (typeof startBridge !== 'function') {
    const message = 'DB AI pane start service unavailable'
    showNotice(message)
    return
  }
  let started: DatabaseAiPaneLifecycleResult
  try {
    started = await startBridge({ requestId, assistantMessageId: messageId })
  } catch (error) {
    const message = bridgeErrorMessage(error, 'DB AI pane request failed to start')
    showNotice(message)
    return
  }
  if (!started.ok) {
    const message = started.errorMessage || 'DB AI pane request failed to start'
    showNotice(message)
    return
  }
  if (!isDbAiPaneLifecycleData(started.data, { requestId, assistantMessageId: messageId })) {
    const message = 'DB AI pane backend returned malformed lifecycle data.'
    showNotice(message)
    return
  }
  applyDbAiPaneAssistantMessage(started.data.assistantMessage)
  const generateBridge = window.aiops?.generateDatabaseAiPaneResponse
  if (typeof generateBridge !== 'function') {
    const message = 'DB AI pane response service unavailable'
    showNotice(message)
    return
  }
  try {
    const result = await generateBridge({
      requestId,
      assistantMessageId: messageId,
      prompt,
      context: {
        connectionId: context.connectionId,
        dbType: context.dbType || undefined,
        databaseName: context.catalogName,
        schemaName: context.schemaName,
        contextSummary
      },
      activeSql: activeSqlTab.value?.sql ?? '',
      messages: dbAiPaneMessages.value.slice(-12).map((message) => ({ role: message.role, content: message.content }))
    })
    finishDbAiPaneMessage(messageId, result, requestId)
  } catch (error) {
    const message = bridgeErrorMessage(error, 'DB AI pane response failed')
    showNotice(message)
  }
}

function applyDbAiPaneAssistantMessage(assistantMessage: DbAiPaneMessage) {
  dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
    if (message.id !== assistantMessage.id) return message
    return assistantMessage
  })
  scrollDbAiPaneMessagesToBottom()
}

function finishDbAiPaneMessage(messageId: string, result: DatabaseAiPaneResponseResult, requestId: string) {
  const hasValidResponseData = isDbAiPaneResponseData(result.data, { requestId, assistantMessageId: messageId })
  const responseData = hasValidResponseData ? result.data : null
  if (result.ok && !hasValidResponseData) {
    const message = 'DB AI pane backend returned malformed response data.'
    showNotice(message)
    return
  }
  if (!result.ok && !hasValidResponseData) {
    const message = result.errorMessage || 'DB AI pane response failed'
    showNotice(message)
    return
  }
  dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
    if (message.id !== messageId || message.status === 'cancelled') return message
    if (responseData) return responseData.assistantMessage
    return message
  })
  scrollDbAiPaneMessagesToBottom()
}

async function cancelDbAiPaneResponse() {
  const activeAssistant = [...dbAiPaneMessages.value]
    .reverse()
    .find((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'))
  if (!activeAssistant) return
  const cancelBridge = window.aiops?.cancelDatabaseAiPaneResponse
  if (typeof cancelBridge !== 'function') {
    showNotice('DB AI pane cancel service unavailable')
    return
  }
  let result: DatabaseAiPaneLifecycleResult
  try {
    result = await cancelBridge({ requestId: activeAssistant.requestId, assistantMessageId: activeAssistant.id })
  } catch (error) {
    showNotice(bridgeErrorMessage(error, 'DB AI pane cancel failed'))
    return
  }
  if (!result.ok) {
    showNotice(result.errorMessage || 'DB AI pane cancel failed')
    return
  }
  if (!isDbAiPaneLifecycleData(result.data, { requestId: activeAssistant.requestId, assistantMessageId: activeAssistant.id })) {
    showNotice('DB AI pane backend returned malformed lifecycle data.')
    return
  }
  applyDbAiPaneAssistantMessage(result.data.assistantMessage)
  showNotice('DB AI pane response stopped')
}

function resetDbAiPaneConversation() {
  dbAiPaneMessages.value = []
  dbAiPaneDraft.value = ''
  showNotice('DB AI pane conversation reset')
}

function dbAiPaneStatusLabel(status: DbAiPaneMessageStatus) {
  if (status === 'queued') return 'Queued'
  if (status === 'streaming') return 'Streaming'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'error') return 'Error'
  return 'Done'
}

function scrollDbAiPaneMessagesToBottom() {
  void nextTick(() => {
    const el = dbAiPaneMessageListRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function clampDbAiPaneWidth(value: number) {
  if (!Number.isFinite(value)) return DB_AI_PANE_DEFAULT_WIDTH
  return Math.min(DB_AI_PANE_MAX_WIDTH, Math.max(DB_AI_PANE_MIN_WIDTH, Math.round(value)))
}

function startDbAiPaneResize(event: PointerEvent) {
  event.preventDefault()
  dbAiPaneResizeStartX = event.clientX
  dbAiPaneResizeStartWidth = dbAiPaneWidth.value
  dbAiPaneResizing.value = true
  window.addEventListener('pointermove', handleDbAiPaneResizeMove)
  window.addEventListener('pointerup', stopDbAiPaneResize)
  window.addEventListener('mousemove', handleDbAiPaneResizeMove)
  window.addEventListener('mouseup', stopDbAiPaneResize)
}

function handleDbAiPaneResizeMove(event: PointerEvent | MouseEvent) {
  if (!dbAiPaneResizing.value) return
  dbAiPaneWidth.value = clampDbAiPaneWidth(dbAiPaneResizeStartWidth + dbAiPaneResizeStartX - event.clientX)
}

function stopDbAiPaneResize() {
  if (!dbAiPaneResizing.value) return
  dbAiPaneResizing.value = false
  window.removeEventListener('pointermove', handleDbAiPaneResizeMove)
  window.removeEventListener('pointerup', stopDbAiPaneResize)
  window.removeEventListener('mousemove', handleDbAiPaneResizeMove)
  window.removeEventListener('mouseup', stopDbAiPaneResize)
}

function resetDbAiPaneWidth() {
  dbAiPaneWidth.value = DB_AI_PANE_DEFAULT_WIDTH
}

function applyDbAiPaneStateSnapshot(snapshot: DatabaseAiPaneStateSnapshot) {
  dbAiPaneOpen.value = snapshot.open === true
  dbAiPaneWidth.value = clampDbAiPaneWidth(snapshot.width)
  if (snapshot.context?.connectionId) applyDbAiPaneContext(snapshot.context, true)
  else ensureDbAiPaneContextInitialized(true)
  dbAiPaneDraft.value = snapshot.draft || ''
  dbAiPaneMessages.value = snapshot.messages.map((message) => ({ ...message }))
}

function currentDbAiPaneStateSnapshot(): DatabaseAiPaneStateSnapshot {
  return {
    open: dbAiPaneOpen.value,
    width: dbAiPaneWidth.value,
    context: { ...dbAiPaneContext },
    draft: dbAiPaneDraft.value,
    messages: dbAiPaneMessages.value.slice(-24).map((message) => ({ ...message }))
  }
}

async function loadDbAiPaneState() {
  dbAiPaneStateHydrating = true
  try {
    const bridge = window.aiops.getDatabaseAiPaneState
    if (typeof bridge !== 'function') {
      ensureDbAiPaneContextInitialized(true)
      showNotice('DB AI pane state service unavailable')
      return
    }
    const result = await bridge()
    if (!result.ok || !result.data) {
      ensureDbAiPaneContextInitialized(true)
      showNotice(result.errorMessage || 'DB AI pane state load failed')
      return
    }
    if (!isDbAiPaneStateSnapshot(result.data)) {
      ensureDbAiPaneContextInitialized(true)
      showNotice('DB AI pane state backend returned malformed result data.')
      return
    }
    applyDbAiPaneStateSnapshot(result.data)
  } catch {
    ensureDbAiPaneContextInitialized(true)
    showNotice('DB AI pane state load failed')
  } finally {
    dbAiPaneStateHydrating = false
  }
}

async function persistDbAiPaneState() {
  if (dbAiPaneStateHydrating) return
  const bridge = window.aiops.saveDatabaseAiPaneState
  if (typeof bridge !== 'function') {
    if (!dbAiPaneStateNoticeShown) {
      dbAiPaneStateNoticeShown = true
      showNotice('DB AI pane state service unavailable')
    }
    return
  }
  try {
    const result = await bridge(currentDbAiPaneStateSnapshot())
    if (!result.ok && !dbAiPaneStateNoticeShown) {
      dbAiPaneStateNoticeShown = true
      showNotice(result.errorMessage || 'DB AI pane state save failed')
      return
    }
    if (result.ok && !isDbAiPaneStateSnapshot(result.data) && !dbAiPaneStateNoticeShown) {
      dbAiPaneStateNoticeShown = true
      showNotice('DB AI pane state backend returned malformed result data.')
    }
  } catch {
    if (!dbAiPaneStateNoticeShown) {
      dbAiPaneStateNoticeShown = true
      showNotice('DB AI pane state save failed')
    }
  }
}

function openSqlConsole(connectionId?: string) {
  const context = resolveSqlConsoleContext(connectionId)
  const connection = findConnection(context.connectionId)
  const catalog = connection?.catalogs.find((item) => item.name === context.catalogName) ?? connection?.catalogs[0]
  const tab: WorkspaceTab = {
    id: `tab-sql-${Date.now()}`,
    kind: 'sql',
    title: nextQueryTitle(),
    connectionId: context.connectionId,
    catalogName: catalog?.name ?? context.catalogName,
    schemaName: context.schemaName,
    sql: '',
    savedSql: '',
    saving: false,
    saveError: null,
    resultTabs: [],
    activeResultTabId: 'overview',
    history: []
  }
  tabs.value.push(tab)
  activeTabId.value = tab.id
  closeMenus()
}

function renderDefaultSql(connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined, schemaName?: string) {
  const table = schemaName ? catalog?.schemas?.find((schema) => schema.name === schemaName)?.tables[0] : catalog?.tables?.[0]
  if (!table) return 'select 1;'
  const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', catalog?.name ?? '', schemaName, table.name)
  if (connection?.dbType === 'oracle') return `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;`
  if (connection?.dbType === 'sqlserver') return `SELECT TOP (100) *\nFROM ${qualified};`
  return `SELECT *\nFROM ${qualified}\nLIMIT 100;`
}

function buildQualifiedTableReference(dbType: DatabaseEngineCode, catalogName: string, schemaName: string | undefined, tableName: string) {
  const quotedTable = quoteSqlIdentifierForDialect(tableName, dbType)
  if (dbType === 'presto' && catalogName && schemaName) {
    return `${quoteSqlIdentifierForDialect(catalogName, dbType)}.${quoteSqlIdentifierForDialect(schemaName, dbType)}.${quotedTable}`
  }
  if (dbType === 'clickhouse' && catalogName) {
    return `${quoteSqlIdentifierForDialect(catalogName, dbType)}.${quotedTable}`
  }
  if ((isPostgresCompatibleDbType(dbType) || dbType === 'oracle' || dbType === 'sqlserver') && schemaName) {
    return `${quoteSqlIdentifierForDialect(schemaName, dbType)}.${quotedTable}`
  }
  if (dbType === 'sqlite' && catalogName) {
    return `${quoteSqlIdentifierForDialect(catalogName, dbType)}.${quotedTable}`
  }
  return quotedTable
}

function quoteSqlIdentifierForDialect(value: string, dbType: DatabaseEngineCode) {
  if (isMysqlCompatibleDbType(dbType) || dbType === 'clickhouse') return `\`${String(value).replace(/`/g, '``')}\``
  if (dbType === 'sqlserver') return `[${String(value).replace(/]/g, ']]')}]`
  return `"${String(value).replace(/"/g, '""')}"`
}

function runSql(mode: 'all' | 'current' | 'explain') {
  const tab = activeSqlTab.value
  if (!tab || !activeSqlCanRun.value) return
  const sql = resolveSqlForRun(tab, mode)
  if (!sql.trim()) {
    showNotice('SQL is empty')
    return
  }
  void appendSqlExecution(tab, sql)
}

async function appendSqlExecution(tab: Extract<WorkspaceTab, { kind: 'sql' }>, sql: string) {
  const result = createRunningSqlResult(tab, sql)
  tab.resultTabs.push(result)
  tab.activeResultTabId = result.id

  let outcome: SqlExecutionOutcome
  try {
    const response = await executeSqlThroughBackend(tab, sql)
    outcome = sqlOutcomeFromBackendResult(response)
  } catch (error) {
    outcome = { payload: createSqlErrorPayload(errorToMessage(error)), execution: null }
  }

  patchSqlResult(tab, result.id, outcome.payload)
  if (outcome.execution) {
    const resultTabId = tab.resultTabs.some((item) => item.id === result.id) ? result.id : null
    tab.history.push({
      id: outcome.execution.id,
      resultTabId,
      title: result.title,
      sql,
      message: outcome.execution.message,
      status: outcome.execution.status,
      durationMs: outcome.execution.durationMs,
      rowCount: outcome.execution.rowCount,
      createdAt: outcome.execution.createdAt
    })
  }
}

function runSqlFromShortcut() {
  const selected = getSelectedSqlText()
  runSql(selected.trim() ? 'current' : 'all')
}

function resolveSqlForRun(tab: Extract<WorkspaceTab, { kind: 'sql' }>, mode: 'all' | 'current' | 'explain') {
  if (mode === 'all') return tab.sql.trim()
  if (mode === 'current') return getSelectedSqlText().trim() || currentSqlStatement(tab.sql, getSqlCursorOffset()).trim()
  const statement = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim() || firstStatement(tab.sql)
  return statement ? `EXPLAIN ${stripExplainPrefix(statement)}` : ''
}

function createRunningSqlResult(tab: Extract<WorkspaceTab, { kind: 'sql' }>, sql: string): SqlResult {
  const seq = resultSeq.value++
  const idx = tab.resultTabs.length + 1
  const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 40) || 'SQL'
  return {
    id: `result-${seq}`,
    title: `#${seq}-${idx} ${preview}`,
    sql,
    status: 'running',
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs: 0,
    error: null,
    message: 'Running'
  }
}

async function executeSqlThroughBackend(tab: Extract<WorkspaceTab, { kind: 'sql' }>, sql: string): Promise<DatabaseSqlExecuteResult> {
  const connection = findConnection(tab.connectionId)
  return window.aiops.executeDatabaseSql({
    connectionId: tab.connectionId,
    dbType: connection?.dbType,
    sql,
    databaseName: tab.catalogName,
    schemaName: tab.schemaName
  })
}

function sqlOutcomeFromBackendResult(result: DatabaseSqlExecuteResult | undefined): SqlExecutionOutcome {
  if (!result || typeof result !== 'object') {
    return { payload: createSqlErrorPayload('Backend SQL executor returned an empty response.'), execution: null }
  }
  if (!result.ok) {
    const execution = isDatabaseSqlExecutionRecord(result.execution) && result.execution.status === 'error' ? result.execution : null
    return {
      payload: createSqlErrorPayload(execution?.message || result.errorMessage || 'Backend SQL executor failed.', execution?.durationMs ?? 0),
      execution
    }
  }
  if (!isDatabaseSqlExecuteData(result.data)) {
    return { payload: createSqlErrorPayload('Backend SQL executor returned malformed result data.'), execution: null }
  }
  const data = result.data
  return {
    payload: {
      status: 'ok',
      columns: data.columns,
      rows: data.rows,
      rowCount: data.rowCount,
      durationMs: data.durationMs,
      error: null,
      message: data.execution.message
    },
    execution: data.execution
  }
}

function createSqlErrorPayload(message: string, durationMs = 0): SqlExecutionPayload {
  return {
    status: 'error',
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs,
    error: message,
    message
  }
}

function patchSqlResult(tab: Extract<WorkspaceTab, { kind: 'sql' }>, resultId: string, payload: SqlExecutionPayload) {
  const index = tab.resultTabs.findIndex((item) => item.id === resultId)
  if (index === -1) return
  tab.resultTabs[index] = { ...tab.resultTabs[index], ...payload }
}

function errorToMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Backend SQL executor failed.'
}

function bridgeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

function defaultSqlFileName(tab: Extract<WorkspaceTab, { kind: 'sql' }>) {
  const connection = findConnection(tab.connectionId)
  const parts = [tab.title, connection?.name, tab.catalogName, tab.schemaName].filter(Boolean)
  const base = parts.join('-') || 'query'
  const safe = base
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${safe || 'query'}.sql`
}

function fileNameFromPath(filePath: string) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || filePath
}

async function pickSqlSavePath(tab: Extract<WorkspaceTab, { kind: 'sql' }>) {
  const showSaveDialog = window.aiops?.showSaveDialog
  if (typeof showSaveDialog !== 'function') {
    return { ok: false as const, error: 'SQL save dialog service unavailable' }
  }
  try {
    const result = await showSaveDialog({
      defaultPath: tab.filePath || defaultSqlFileName(tab),
      filters: [{ name: 'SQL Files', extensions: ['sql'] }]
    })
    if (!result || result.canceled || !result.filePath) return { ok: true as const, canceled: true as const }
    return { ok: true as const, canceled: false as const, filePath: result.filePath }
  } catch (error) {
    return { ok: false as const, error: bridgeErrorMessage(error, 'SQL save dialog failed') }
  }
}

async function saveActiveSql(forceSaveAs: boolean) {
  const tab = activeSqlTab.value
  if (!tab || tab.saving) return
  const writeLocalFile = window.aiops?.writeLocalFile
  if (typeof writeLocalFile !== 'function') {
    tab.saveError = 'SQL file writer service unavailable'
    showNotice(tab.saveError)
    return
  }

  tab.saving = true
  tab.saveError = null
  try {
    let targetPath = forceSaveAs ? '' : tab.filePath || ''
    if (!targetPath) {
      const picked = await pickSqlSavePath(tab)
      if (!picked.ok) {
        tab.saveError = picked.error
        showNotice(tab.saveError)
        return
      }
      if (picked.canceled) {
        showNotice('SQL save cancelled')
        return
      }
      targetPath = picked.filePath
    }
    const result = await writeLocalFile(targetPath, tab.sql)
    if (result?.ok !== true) {
      tab.saveError = result?.errorMessage || 'SQL file save failed'
      showNotice(tab.saveError)
      return
    }
    if (!isLocalFileWriteData(result.data, targetPath, tab.sql)) {
      tab.saveError = SQL_FILE_WRITE_MALFORMED_MESSAGE
      showNotice(tab.saveError)
      return
    }
    tab.filePath = targetPath
    tab.savedSql = tab.sql
    tab.saveError = null
    showNotice(`SQL saved to ${fileNameFromPath(targetPath)}`)
  } catch (error) {
    tab.saveError = bridgeErrorMessage(error, 'SQL file save failed')
    showNotice(tab.saveError)
  } finally {
    tab.saving = false
  }
}

function firstStatement(sql: string) {
  return sql
    .split(';')
    .map((item) => item.trim())
    .find(Boolean) || ''
}

function getSelectedSqlText() {
  const editor = sqlEditorRef.value
  return editor?.getSelectedText() ?? ''
}

function sqlCursorPosition(text: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, clamped)
  const line = before ? before.split('\n').length : 1
  const lastBreak = before.lastIndexOf('\n')
  return { line, column: clamped - lastBreak }
}

function syncSqlEditorState(metrics?: DatabaseSqlEditorMetrics) {
  if (!metrics) {
    const tab = activeSqlTab.value
    const position = sqlCursorPosition(tab?.sql ?? '', sqlEditorRef.value?.getCursorOffset() ?? 0)
    sqlEditorActiveLine.value = Math.max(1, Math.min(position.line, activeSqlEditorLineCount.value))
    sqlEditorActiveColumn.value = Math.max(1, position.column)
    sqlEditorSelectionSize.value = 0
    sqlEditorScrollTop.value = 0
    return
  }
  sqlEditorActiveLine.value = Math.max(1, Math.min(metrics.line, activeSqlEditorLineCount.value))
  sqlEditorActiveColumn.value = Math.max(1, metrics.column)
  sqlEditorSelectionSize.value = Math.max(0, metrics.selectionSize)
  sqlEditorScrollTop.value = Math.max(0, metrics.scrollTop)
}

function openSqlFind(replace: boolean) {
  if (!activeSqlTab.value) return
  const selected = getSelectedSqlText()
  if (selected && !selected.includes('\n')) sqlFindQuery.value = selected
  sqlFindOpen.value = true
  sqlFindReplaceOpen.value = replace || sqlFindReplaceOpen.value
  alignSqlFindIndexToSelection()
  void nextTick(() => {
    const target = replace && sqlFindQuery.value ? sqlReplaceInputRef.value : sqlFindInputRef.value
    target?.focus()
    target?.select()
  })
}

function closeSqlFind(refocusEditor = false) {
  sqlFindOpen.value = false
  sqlFindReplaceOpen.value = false
  if (refocusEditor) sqlEditorRef.value?.focus()
}

function toggleSqlFindReplace() {
  sqlFindReplaceOpen.value = !sqlFindReplaceOpen.value
  void nextTick(() => {
    ;(sqlFindReplaceOpen.value ? sqlReplaceInputRef.value : sqlFindInputRef.value)?.focus()
  })
}

function handleSqlFindKeydown(event: KeyboardEvent, field: 'query' | 'replace') {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSqlFind(true)
    return
  }
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (field === 'replace') {
    replaceCurrentSqlFindMatch()
    return
  }
  goToSqlFindMatch(event.shiftKey ? -1 : 1)
}

function findSqlTextMatches(text: string, query: string, caseSensitive: boolean): TextRange[] {
  if (!query) return []
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches: TextRange[] = []
  let cursor = 0
  while (cursor <= haystack.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) break
    matches.push({ start: index, end: index + query.length })
    cursor = index + Math.max(1, query.length)
  }
  return matches
}

function alignSqlFindIndexToSelection() {
  const editor = sqlEditorRef.value
  const matches = sqlFindMatches.value
  if (!editor || !matches.length) {
    sqlFindActiveIndex.value = matches.length ? 0 : -1
    return
  }
  const start = editor.getSelectionRange().start
  const exact = matches.findIndex((match) => match.start === start)
  sqlFindActiveIndex.value = exact
}

function firstSqlFindMatchAtOrAfter(offset: number, matches = sqlFindMatches.value) {
  const index = matches.findIndex((match) => match.start >= offset)
  return index >= 0 ? index : 0
}

function selectSqlFindMatch(index: number) {
  const matches = sqlFindMatches.value
  if (!matches.length) {
    sqlFindActiveIndex.value = -1
    return
  }
  const nextIndex = ((index % matches.length) + matches.length) % matches.length
  const match = matches[nextIndex]
  sqlFindActiveIndex.value = nextIndex
  setSqlEditorSelection(match.start, match.end)
}

function goToSqlFindMatch(direction: 1 | -1) {
  const matches = sqlFindMatches.value
  if (!matches.length) {
    sqlFindActiveIndex.value = -1
    return
  }
  if (sqlFindActiveIndex.value < 0) {
    const editor = sqlEditorRef.value
    const cursor = editor?.getSelectionRange().end ?? 0
    const index = direction > 0 ? firstSqlFindMatchAtOrAfter(cursor, matches) : firstSqlFindMatchAtOrAfter(cursor, matches) - 1
    selectSqlFindMatch(index)
    return
  }
  selectSqlFindMatch(sqlFindActiveIndex.value + direction)
}

function replaceCurrentSqlFindMatch() {
  const matches = sqlFindMatches.value
  if (!matches.length) return
  const editor = sqlEditorRef.value
  const selectedStart = editor?.getSelectionRange().start ?? -1
  const activeIndex = matches.findIndex((match) => match.start === selectedStart)
  const match = matches[activeIndex >= 0 ? activeIndex : Math.max(0, sqlFindActiveIndex.value)]
  const sql = activeSqlTab.value?.sql ?? ''
  const nextSql = `${sql.slice(0, match.start)}${sqlFindReplace.value}${sql.slice(match.end)}`
  const nextCursor = match.start + sqlFindReplace.value.length
  setEditorSql(nextSql, match.start, nextCursor)
  void nextTick(() => {
    const nextMatches = sqlFindMatches.value
    sqlFindActiveIndex.value = nextMatches.length ? firstSqlFindMatchAtOrAfter(nextCursor, nextMatches) : -1
    if (nextMatches.length) selectSqlFindMatch(sqlFindActiveIndex.value)
  })
}

function replaceAllSqlFindMatches() {
  const matches = sqlFindMatches.value
  const sql = activeSqlTab.value?.sql ?? ''
  if (!matches.length) return
  const nextSql = matches
    .slice()
    .reverse()
    .reduce((text, match) => `${text.slice(0, match.start)}${sqlFindReplace.value}${text.slice(match.end)}`, sql)
  setEditorSql(nextSql, matches[0].start, matches[0].start + sqlFindReplace.value.length)
  sqlFindActiveIndex.value = -1
  showNotice(`Replaced ${matches.length} match${matches.length > 1 ? 'es' : ''}`)
}

function setSqlEditorSelection(selectionStart: number, selectionEnd = selectionStart) {
  void nextTick(() => {
    const editor = sqlEditorRef.value
    const sql = activeSqlTab.value?.sql ?? ''
    if (!editor) return
    const start = Math.max(0, Math.min(selectionStart, sql.length))
    const end = Math.max(0, Math.min(selectionEnd, sql.length))
    editor.setSelectionRange(start, end)
    syncSqlEditorState()
  })
}

function focusSqlEditor(event?: MouseEvent) {
  if (event?.target instanceof HTMLTextAreaElement || event?.target instanceof HTMLInputElement || event?.target instanceof HTMLButtonElement) return
  sqlEditorRef.value?.focus()
  syncSqlEditorState()
}

function clampSqlPanePercent(value: number) {
  if (!Number.isFinite(value)) return SQL_PANE_DEFAULT_PERCENT
  return Math.min(SQL_PANE_MAX_PERCENT, Math.max(SQL_PANE_MIN_PERCENT, value))
}

function updateSqlPaneSplitFromPointer(event: PointerEvent | MouseEvent) {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const panes = sqlPaneResizeElement ?? target?.closest<HTMLElement>('.db-sql-panes') ?? document.querySelector<HTMLElement>('.db-sql-panes')
  if (!panes) return
  const rect = panes.getBoundingClientRect()
  if (!rect.height) return
  const raw = ((event.clientY - rect.top) / rect.height) * 100
  sqlPaneEditorPercent.value = Math.round(clampSqlPanePercent(raw) * 10) / 10
}

function handleSqlPaneResizeMove(event: PointerEvent | MouseEvent) {
  if (!sqlPaneResizing.value) return
  updateSqlPaneSplitFromPointer(event)
}

function stopSqlPaneResize() {
  if (!sqlPaneResizing.value) return
  sqlPaneResizing.value = false
  sqlPaneResizeElement = null
  window.removeEventListener('pointermove', handleSqlPaneResizeMove)
  window.removeEventListener('pointerup', stopSqlPaneResize)
  window.removeEventListener('mousemove', handleSqlPaneResizeMove)
  window.removeEventListener('mouseup', stopSqlPaneResize)
}

function startSqlPaneResize(event: PointerEvent) {
  event.preventDefault()
  sqlPaneResizeElement = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.db-sql-panes') ?? null
  sqlPaneResizing.value = true
  updateSqlPaneSplitFromPointer(event)
  window.addEventListener('pointermove', handleSqlPaneResizeMove)
  window.addEventListener('pointerup', stopSqlPaneResize)
  window.addEventListener('mousemove', handleSqlPaneResizeMove)
  window.addEventListener('mouseup', stopSqlPaneResize)
}

function resetSqlPaneSplit() {
  sqlPaneEditorPercent.value = SQL_PANE_DEFAULT_PERCENT
}

function getSqlCursorOffset() {
  const editor = sqlEditorRef.value
  if (!editor) return activeSqlTab.value?.sql.length ?? 0
  return editor.getCursorOffset()
}

function getSqlSelectionRange(): TextRange {
  const editor = sqlEditorRef.value
  const length = activeSqlTab.value?.sql.length ?? 0
  if (!editor) return { start: length, end: length }
  return editor.getSelectionRange()
}

function currentSqlStatement(sql: string, cursorOffset: number) {
  const range = currentSqlStatementRange(sql, cursorOffset)
  return sql.slice(range.start, range.end).trim()
}

function currentSqlStatementRange(sql: string, cursorOffset: number): TextRange {
  const offset = Math.max(0, Math.min(cursorOffset, sql.length))
  let start = 0
  let end = sql.length
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] !== ';') continue
    if (index < offset) start = index + 1
    else {
      end = index
      break
    }
  }
  while (start < end && /\s/.test(sql[start])) start += 1
  while (end > start && /\s/.test(sql[end - 1])) end -= 1
  return { start, end }
}

function stripExplainPrefix(sql: string) {
  return sql.replace(/^\s*explain\s+/i, '').trim()
}

function closeResultTab(resultId: string) {
  const tab = activeSqlTab.value
  if (!tab || resultId === 'overview') return
  const closedIndex = tab.resultTabs.findIndex((result) => result.id === resultId)
  if (closedIndex === -1) return
  tab.resultTabs.splice(closedIndex, 1)
  delete sqlResultViewStateById[resultId]
  tab.history.forEach((item) => {
    if (item.resultTabId === resultId) item.resultTabId = null
  })
  if (tab.activeResultTabId === resultId) {
    const fallback = tab.resultTabs[closedIndex - 1] ?? tab.resultTabs[closedIndex] ?? null
    tab.activeResultTabId = fallback?.id ?? 'overview'
  }
}

function openSqlHistoryResult(history: SqlHistory) {
  const tab = activeSqlTab.value
  if (!tab || !history.resultTabId) return
  if (!tab.resultTabs.some((result) => result.id === history.resultTabId)) return
  tab.activeResultTabId = history.resultTabId
}

function isSqlHistoryClosed(history: SqlHistory) {
  const tab = activeSqlTab.value
  if (!tab || !history.resultTabId) return true
  return !tab.resultTabs.some((result) => result.id === history.resultTabId)
}

function updateSqlResultPage(page: number) {
  const result = activeSqlResult.value
  if (!result) return
  const state = getOrCreateSqlResultViewState(result.id)
  state.page = clampPage(page, filteredSqlRows.value.length, state.pageSize)
}

function updateSqlResultPageSize(size: number) {
  const result = activeSqlResult.value
  if (!result) return
  const state = getOrCreateSqlResultViewState(result.id)
  state.pageSize = size
  state.page = clampPage(state.page, filteredSqlRows.value.length, state.pageSize)
}

function gotoLastSqlResultPage() {
  const result = activeSqlResult.value
  if (!result) return
  const state = getOrCreateSqlResultViewState(result.id)
  state.page = Math.max(1, Math.ceil(filteredSqlRows.value.length / state.pageSize))
}

function cycleSqlSort(column: string) {
  const result = activeSqlResult.value
  if (!result) return
  const state = getOrCreateSqlResultViewState(result.id)
  state.sort = nextSort(state.sort, column)
  state.page = 1
}

function applySqlFilter(column: string, filter: DbFilter | null) {
  const result = activeSqlResult.value
  if (!result) return
  const state = getOrCreateSqlResultViewState(result.id)
  state.filters = replaceFilter(state.filters, column, filter)
  state.page = 1
}

function updateDataPage(page: number) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.page = tab.total === null ? Math.max(1, Math.floor(page)) : clampPage(page, tab.total, tab.pageSize)
  void reloadDataTab(tab)
}

function updateDataPageSize(size: number) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.pageSize = size
  tab.page = 1
  void reloadDataTab(tab)
}

function gotoLastDataPage() {
  const tab = activeDataTab.value
  if (!tab) return
  void (async () => {
    if (tab.total === null) await refreshDataTotal()
    const total = tab.total ?? tab.rowCount
    tab.page = Math.max(1, Math.ceil(total / tab.pageSize))
    await reloadDataTab(tab)
  })()
}

function cycleDataSort(column: string) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.sort = nextSort(tab.sort, column)
  tab.page = 1
  void reloadDataTab(tab)
}

function applyDataFilter(column: string, filter: DbFilter | null) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.filters = replaceFilter(tab.filters, column, filter)
  tab.page = 1
  void reloadDataTab(tab)
}

function applyWhere() {
  const tab = activeDataTab.value
  if (!tab) return
  tab.whereRaw = tab.whereDraft.trim()
  tab.whereDraft = tab.whereRaw
  tab.page = 1
  void reloadDataTab(tab)
}

function canEditDataTab(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  return dataEditDisabledReason(tab) === ''
}

function dataEditDisabledReason(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  const connection = findConnection(tab.connectionId)
  const table = findTable(tab.connectionId, tab.catalogName, tab.tableId, tab.schemaName)
  if (!connection) return 'Connection is unavailable'
  if (connection.readonly) return 'Connection is readonly'
  if (isViewTable(tab)) return 'View editing is disabled in this version'
  if (!table) return 'Table is unavailable'
  return ''
}

function makeDataMutationPlanState(overrides: Partial<DataMutationPlanState> = {}): DataMutationPlanState {
  return {
    key: '',
    loading: false,
    statementCount: 0,
    preview: '',
    warning: '',
    error: '',
    ...overrides
  }
}

function buildDataMutationPayload(tab: Extract<WorkspaceTab, { kind: 'data' }>): DatabaseTableMutation[] {
  return [
    ...Array.from(tab.dirtyState.deletedRowKeys).map((rowKey) => {
      const snapshot = tab.dirtyState.originalRows.get(rowKey)
      return {
        kind: 'delete' as const,
        rowKey,
        primaryKey: tab.primaryKey.slice(),
        ...(snapshot ? { originalRow: { ...snapshot } } : {})
      }
    }),
    ...Array.from(tab.dirtyState.updatedCells.entries()).map(([rowKey, patch]) => {
      const snapshot = tab.dirtyState.originalRows.get(rowKey)
      return {
        kind: 'update' as const,
        rowKey,
        primaryKey: tab.primaryKey.slice(),
        patch: { ...patch },
        ...(snapshot ? { originalRow: { ...snapshot } } : {})
      }
    }),
    ...tab.dirtyState.newRows.map((row) => ({ kind: 'insert' as const, values: { ...row.values } }))
  ]
}

function buildDataMutationPlanInput(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  const connection = findConnection(tab.connectionId)
  return {
    connectionId: tab.connectionId,
    dbType: connection?.dbType,
    databaseName: tab.catalogName,
    schemaName: tab.schemaName,
    tableName: tab.tableName,
    columns: tab.columns.slice(),
    knownColumns: tab.knownColumns.slice(),
    mutations: buildDataMutationPayload(tab)
  }
}

function resetDataMutationPlan(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  tab.mutationPlan = makeDataMutationPlanState()
}

async function refreshDataMutationPlan(tab: Extract<WorkspaceTab, { kind: 'data' }>, force = false): Promise<DataMutationPlanState> {
  if (!isDataTabDirty(tab)) {
    resetDataMutationPlan(tab)
    return tab.mutationPlan
  }
  const input = buildDataMutationPlanInput(tab)
  const key = JSON.stringify(input)
  if (!force && tab.mutationPlan.key === key && !tab.mutationPlan.loading) return tab.mutationPlan
  tab.mutationPlan = makeDataMutationPlanState({ key, loading: true })
  try {
    const result = await window.aiops.planDatabaseTableMutation(input)
    if (tab.mutationPlan.key !== key) return tab.mutationPlan
    if (!result.ok) {
      tab.mutationPlan = makeDataMutationPlanState({
        key,
        error: result.errorMessage || 'Backend table mutation planning failed.'
      })
      return tab.mutationPlan
    }
    if (!isDatabaseTableMutationPlanData(result.data)) {
      tab.mutationPlan = makeDataMutationPlanState({
        key,
        error: DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE
      })
      return tab.mutationPlan
    }
    tab.mutationPlan = makeDataMutationPlanState({
      key,
      statementCount: result.data.statementCount,
      preview: result.data.preview,
      warning: result.data.warning
    })
  } catch (error) {
    if (tab.mutationPlan.key === key) {
      tab.mutationPlan = makeDataMutationPlanState({
        key,
        error: errorToMessage(error)
      })
    }
  }
  return tab.mutationPlan
}

function updateDataCell(rowKey: string, column: string, value: string) {
  const tab = activeDataTab.value
  if (!tab || !canEditDataTab(tab) || tab.saving) return
  tab.saveError = null
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const snapshot = dirtyState.originalRows.get(rowKey)
  if (!snapshot) return
  const currentPatch = dirtyState.updatedCells.get(rowKey) ?? {}
  const oldValue = Object.prototype.hasOwnProperty.call(currentPatch, column) ? currentPatch[column] : snapshot[column]
  if (oldValue === value) return
  const nextPatch = { ...currentPatch, [column]: value }
  if (value === snapshot[column]) delete nextPatch[column]
  if (Object.keys(nextPatch).length) dirtyState.updatedCells.set(rowKey, nextPatch)
  else dirtyState.updatedCells.delete(rowKey)
  tab.dirtyState = dirtyState
  tab.undoStack = [...tab.undoStack, { kind: 'update', rowKey, column, oldValue, newValue: value }]
  void refreshDataMutationPlan(tab)
}

function updateNewDataRowCell(tmpId: string, column: string, value: string) {
  const tab = activeDataTab.value
  if (!tab || !canEditDataTab(tab) || tab.saving) return
  tab.saveError = null
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const newRows = dirtyState.newRows.map((row) => (row.tmpId === tmpId ? { ...row, values: { ...row.values, [column]: value } } : row))
  if (!newRows.some((row) => row.tmpId === tmpId)) return
  tab.dirtyState = { ...dirtyState, newRows }
  void refreshDataMutationPlan(tab)
}

function setActiveDataSelectedRow(key: string) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.selectedRowKey = key
}

function addDataRow() {
  const tab = activeDataTab.value
  if (!tab || tab.saving) return
  const reason = dataEditDisabledReason(tab)
  if (reason) {
    showNotice(reason)
    return
  }
  tab.saveError = null
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const values: Record<string, unknown> = {}
  tab.columns.forEach((column) => {
    values[column] = null
  })
  const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  tab.dirtyState = { ...dirtyState, newRows: [...dirtyState.newRows, { tmpId, values }] }
  tab.undoStack = [...tab.undoStack, { kind: 'add', tmpId }]
  tab.selectedRowKey = tmpId
  void refreshDataMutationPlan(tab)
  showNotice('New row added locally')
}

function deleteSelectedDataRow() {
  const tab = activeDataTab.value
  if (!tab || !tab.selectedRowKey || tab.saving) return
  const reason = dataEditDisabledReason(tab)
  if (reason) {
    showNotice(reason)
    return
  }
  tab.saveError = null
  const key = tab.selectedRowKey
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const newRowIndex = dirtyState.newRows.findIndex((row) => row.tmpId === key)
  if (newRowIndex >= 0) {
    dirtyState.newRows.splice(newRowIndex, 1)
    const addOpIndex = tab.undoStack.findIndex((op) => op.kind === 'add' && op.tmpId === key)
    const undoStack = tab.undoStack.filter((_, index) => index !== addOpIndex)
    tab.dirtyState = dirtyState
    tab.undoStack = addOpIndex >= 0 ? undoStack : [...tab.undoStack]
    tab.selectedRowKey = null
    void refreshDataMutationPlan(tab)
    showNotice('New row removed')
    return
  }
  if (dirtyState.deletedRowKeys.has(key)) return
  const snapshot = dirtyState.originalRows.get(key)
  if (!snapshot) return
  dirtyState.deletedRowKeys.add(key)
  dirtyState.updatedCells.delete(key)
  tab.dirtyState = dirtyState
  tab.undoStack = [...tab.undoStack, { kind: 'delete', rowKey: key, snapshot: { ...snapshot } }]
  tab.selectedRowKey = null
  void refreshDataMutationPlan(tab)
  showNotice('Row marked for deletion')
}

function undoDataChanges() {
  const tab = activeDataTab.value
  if (!tab || tab.saving) return
  tab.saveError = null
  const undoStack = [...tab.undoStack]
  const op = undoStack.pop()
  if (!op) return
  const dirtyState = cloneDirtyState(tab.dirtyState)
  if (op.kind === 'add') {
    dirtyState.newRows = dirtyState.newRows.filter((row) => row.tmpId !== op.tmpId)
  } else if (op.kind === 'delete') {
    dirtyState.deletedRowKeys.delete(op.rowKey)
  } else {
    const snapshot = dirtyState.originalRows.get(op.rowKey)
    if (!snapshot) return
    const patch = { ...(dirtyState.updatedCells.get(op.rowKey) ?? {}) }
    if (op.oldValue === snapshot[op.column]) delete patch[op.column]
    else patch[op.column] = op.oldValue
    if (Object.keys(patch).length) dirtyState.updatedCells.set(op.rowKey, patch)
    else dirtyState.updatedCells.delete(op.rowKey)
  }
  tab.dirtyState = dirtyState
  tab.undoStack = undoStack
  void refreshDataMutationPlan(tab)
  showNotice('Last data edit reverted')
}

async function saveDataChanges() {
  const tab = activeDataTab.value
  if (!tab || tab.saving) return
  const reason = dataEditDisabledReason(tab)
  if (reason) {
    tab.saveError = reason
    showNotice(reason)
    return
  }
  const plan = await refreshDataMutationPlan(tab, true)
  if (plan.error) {
    tab.saveError = plan.error
    showNotice(plan.error)
    return
  }
  if (plan.statementCount === 0) {
    tab.saveError = 'No SQL statement will be generated until a new row contains at least one value.'
    showNotice(tab.saveError)
    return
  }
  tab.saving = true
  tab.saveError = null
  await nextTick()
  const backendResult = await mutateDataTabThroughBackend(tab)
  if (!backendResult.ok) {
    tab.saveError = backendResult.errorMessage || 'Backend table mutation failed.'
    tab.saving = false
    showNotice(tab.saveError)
    return
  }
  if (!isDatabaseTableMutationData(backendResult.data)) {
    tab.saveError = DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE
    tab.saving = false
    showNotice(tab.saveError)
    return
  }
  await reloadDataTab(tab, { withTotal: tab.total !== null, preserveDirty: false })
  tab.saving = false
  showNotice(`Changes saved through backend table store (${plan.statementCount} statement${plan.statementCount > 1 ? 's' : ''})`)
}

function mutateDataTabThroughBackend(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  return window.aiops.mutateDatabaseTable({
    connectionId: tab.connectionId,
    databaseName: tab.catalogName,
    schemaName: tab.schemaName,
    tableName: tab.tableName,
    mutations: buildDataMutationPayload(tab)
  })
}

async function exportDatabaseRowsThroughBackend(input: Parameters<typeof window.aiops.exportDatabaseRows>[0]) {
  if (typeof window.aiops.exportDatabaseRows !== 'function') {
    showNotice('Database export service unavailable')
    return null
  }
  try {
    const result = await window.aiops.exportDatabaseRows(input)
    if (!result.ok) {
      showNotice(result.errorMessage || 'Database export failed')
      return null
    }
    if (!isDatabaseExportData(result.data)) {
      showNotice('Database export backend returned malformed result data.')
      return null
    }
    if (result.data.canceled) {
      showNotice('Database export cancelled')
      return result.data
    }
    showNotice(`Exported ${result.data.exported} row${result.data.exported === 1 ? '' : 's'} to ${result.data.fileName}`)
    return result.data
  } catch (error) {
    showNotice(errorToMessage(error))
    return null
  }
}

function exportActiveSqlResultPage() {
  const tab = activeSqlTab.value
  const result = activeSqlResult.value
  if (!tab || !result || result.status !== 'ok' || !pagedSqlRows.value.length) {
    showNotice('No SQL result rows to export')
    return null
  }
  const connection = findConnection(tab.connectionId)
  return exportDatabaseRowsThroughBackend({
    title: `${tab.title}-${result.title}`,
    kind: 'sql-result',
    columns: result.columns,
    rows: pagedSqlRows.value,
    metadata: {
      connectionName: connection?.name,
      databaseName: tab.catalogName,
      schemaName: tab.schemaName,
      sql: result.sql,
      page: activeSqlResultViewState.value.page,
      pageSize: activeSqlResultViewState.value.pageSize,
      total: filteredSqlRows.value.length
    }
  })
}

function exportActiveDataPage() {
  const tab = activeDataTab.value
  if (!tab || tab.loading || tab.error || !pagedDataRows.value.length) {
    showNotice('No table rows to export')
    return null
  }
  const connection = findConnection(tab.connectionId)
  return exportDatabaseRowsThroughBackend({
    title: `${tab.title}-page-${tab.page}`,
    kind: 'table-page',
    columns: tab.columns,
    rows: pagedDataRows.value,
    metadata: {
      connectionName: connection?.name,
      databaseName: tab.catalogName,
      schemaName: tab.schemaName,
      tableName: tab.tableName,
      page: tab.page,
      pageSize: tab.pageSize,
      total: tab.total
    }
  })
}

function databasePageCommentKeyId(key: DatabasePageCommentKey) {
  return [
    key.scope,
    key.connectionId,
    key.databaseName,
    key.schemaName || '',
    key.tableName || '',
    key.resultId || '',
    key.sql || ''
  ].join('\u001f')
}

function sqlResultCommentKey(tab: Extract<WorkspaceTab, { kind: 'sql' }>, result: SqlResult): DatabasePageCommentKey {
  return {
    scope: 'sql-result',
    connectionId: tab.connectionId,
    databaseName: tab.catalogName,
    ...(tab.schemaName ? { schemaName: tab.schemaName } : {}),
    resultId: result.id,
    sql: result.sql
  }
}

function dataPageCommentKey(tab: Extract<WorkspaceTab, { kind: 'data' }>): DatabasePageCommentKey {
  return {
    scope: 'table-page',
    connectionId: tab.connectionId,
    databaseName: tab.catalogName,
    ...(tab.schemaName ? { schemaName: tab.schemaName } : {}),
    tableName: tab.tableName
  }
}

function labelForChartValue(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function numberForChartValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function buildChartSummary(source: DatabaseChartSource): DatabaseChartSummary | null {
  const rows = source.rows.filter((row) => row && typeof row === 'object')
  const numericColumns = source.columns.filter((column) => rows.some((row) => numberForChartValue(row[column]) !== null))
  const valueColumn = numericColumns[0]
  if (!valueColumn) return null
  const categoryColumn = source.columns.find((column) => column !== valueColumn && rows.some((row) => row[column] !== null && row[column] !== undefined && row[column] !== '')) || valueColumn
  const grouped = new Map<string, number>()
  rows.forEach((row, index) => {
    const numeric = numberForChartValue(row[valueColumn])
    if (numeric === null) return
    const label = labelForChartValue(row[categoryColumn], `Row ${index + 1}`)
    grouped.set(label, (grouped.get(label) || 0) + numeric)
  })
  const sorted = [...grouped.entries()].sort((first, second) => Math.abs(second[1]) - Math.abs(first[1])).slice(0, 12)
  if (!sorted.length) return null
  const max = Math.max(...sorted.map(([, value]) => Math.abs(value)), 1)
  return {
    title: source.title,
    scopeLabel: source.scopeLabel,
    categoryColumn,
    valueColumn,
    rowCount: rows.length,
    bars: sorted.map(([label, value]) => ({ label, value, width: Math.max(4, Math.round((Math.abs(value) / max) * 100)) })),
    numericColumns
  }
}

function openChartModal(source: DatabaseChartSource) {
  chartModal.summary = buildChartSummary(source)
  chartModal.error = chartModal.summary ? '' : 'Current page does not contain a numeric column to chart.'
  chartModal.open = true
  if (!chartModal.summary) showNotice(chartModal.error)
}

function closeChartModal() {
  chartModal.open = false
}

function openActiveSqlResultChart() {
  const tab = activeSqlTab.value
  const result = activeSqlResult.value
  if (!tab || !result || result.status !== 'ok' || !pagedSqlRows.value.length) {
    showNotice('No SQL result rows to chart')
    return
  }
  openChartModal({
    title: `${tab.title} - ${result.title}`,
    scopeLabel: `SQL page ${activeSqlResultViewState.value.page}`,
    columns: result.columns,
    rows: pagedSqlRows.value
  })
}

function openActiveDataChart() {
  const tab = activeDataTab.value
  if (!tab || tab.loading || tab.error || !pagedDataRows.value.length) {
    showNotice('No table rows to chart')
    return
  }
  openChartModal({
    title: `${tab.title} - page ${tab.page}`,
    scopeLabel: [tab.catalogName, tab.schemaName, tab.tableName].filter(Boolean).join(' / '),
    columns: tab.columns,
    rows: pagedDataRows.value
  })
}

async function openCommentModal(input: { title: string; scopeLabel: string; key: DatabasePageCommentKey }) {
  commentModal.open = true
  commentModal.title = input.title
  commentModal.scopeLabel = input.scopeLabel
  commentModal.key = input.key
  commentModal.draft = ''
  commentModal.updatedAt = 0
  commentModal.loading = true
  commentModal.saving = false
  commentModal.error = ''
  if (typeof window.aiops.getDatabasePageComment !== 'function') {
    commentModal.loading = false
    commentModal.error = 'Database comment service unavailable'
    showNotice(commentModal.error)
    return
  }
  try {
    const result = await window.aiops.getDatabasePageComment(input.key)
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(input.key)) return
    commentModal.loading = false
    if (!result.ok) {
      commentModal.error = result.errorMessage || 'Database comment load failed'
      showNotice(commentModal.error)
      return
    }
    if (!isDatabasePageCommentGetData(result.data, input.key)) {
      commentModal.error = 'Database comment backend returned malformed result data.'
      showNotice(commentModal.error)
      return
    }
    commentModal.draft = result.data.record.comment
    commentModal.updatedAt = result.data.record.updatedAt
  } catch (error) {
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(input.key)) return
    commentModal.loading = false
    commentModal.error = bridgeErrorMessage(error, 'Database comment load failed')
    showNotice(commentModal.error)
  }
}

function openActiveSqlResultComment() {
  const tab = activeSqlTab.value
  const result = activeSqlResult.value
  if (!tab || !result || result.status !== 'ok') {
    showNotice('No SQL result context to comment')
    return
  }
  void openCommentModal({
    title: `${tab.title} - ${result.title}`,
    scopeLabel: `SQL result / ${tab.catalogName}${tab.schemaName ? ` / ${tab.schemaName}` : ''}`,
    key: sqlResultCommentKey(tab, result)
  })
}

function openActiveDataComment() {
  const tab = activeDataTab.value
  if (!tab || tab.loading || tab.error) {
    showNotice('No table page context to comment')
    return
  }
  void openCommentModal({
    title: `${tab.title} - page ${tab.page}`,
    scopeLabel: [tab.catalogName, tab.schemaName, tab.tableName].filter(Boolean).join(' / '),
    key: dataPageCommentKey(tab)
  })
}

async function saveActiveComment() {
  const key = commentModal.key
  if (!key || commentModal.loading || commentModal.saving) return
  if (typeof window.aiops.saveDatabasePageComment !== 'function') {
    commentModal.error = 'Database comment service unavailable'
    showNotice(commentModal.error)
    return
  }
  commentModal.saving = true
  commentModal.error = ''
  try {
    const result = await window.aiops.saveDatabasePageComment({ key, comment: commentModal.draft })
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(key)) return
    commentModal.saving = false
    if (!result.ok) {
      commentModal.error = result.errorMessage || 'Database comment save failed'
      showNotice(commentModal.error)
      return
    }
    if (!isDatabasePageCommentSaveData(result.data, key)) {
      commentModal.error = 'Database comment backend returned malformed result data.'
      showNotice(commentModal.error)
      return
    }
    commentModal.draft = result.data.record.comment
    commentModal.updatedAt = result.data.record.updatedAt
    showNotice(result.data.message || 'Comment saved')
  } catch (error) {
    if (!commentModal.key || databasePageCommentKeyId(commentModal.key) !== databasePageCommentKeyId(key)) return
    commentModal.saving = false
    commentModal.error = bridgeErrorMessage(error, 'Database comment save failed')
    showNotice(commentModal.error)
  }
}

function closeCommentModal() {
  if (commentModal.saving) return
  commentModal.open = false
}

function formatChartNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatCommentTime(value: number) {
  if (!value) return ''
  return new Date(value).toLocaleString()
}

function discardDataChanges() {
  const tab = activeDataTab.value
  if (!tab || tab.saving) return
  tab.dirtyState = makeDirtyState(tab.rows, tab.primaryKey)
  tab.undoStack = []
  tab.selectedRowKey = null
  tab.saveError = null
  resetDataMutationPlan(tab)
  showNotice('Local data edits discarded')
}

async function copyDataMutationPreview() {
  const summary = activeDataEditSummary.value
  if (!summary?.preview) return
  if (await copyText(summary.preview)) showNotice('Mutation preview copied')
}

function refreshDataTab() {
  const tab = activeDataTab.value
  if (!tab) return
  void reloadDataTab(tab, { notice: 'Table data refreshed' })
}

async function refreshDataTotal() {
  const tab = activeDataTab.value
  if (!tab) return
  await reloadDataTab(tab, { withTotal: true, preserveDirty: true, notice: 'Table total refreshed' })
}

async function reloadDataTab(tab: Extract<WorkspaceTab, { kind: 'data' }>, options: TableReloadOptions = {}) {
  const preserveDirty = options.preserveDirty ?? true
  tab.loading = true
  tab.error = null
  try {
    const result = await queryDataTabThroughBackend(tab, options.withTotal ?? false)
    if (!result.ok) {
      tab.error = result.errorMessage || 'Backend table query failed.'
      return
    }
    if (!isDatabaseTableQueryData(result.data)) {
      tab.error = 'Backend table query returned malformed result data.'
      return
    }
    const data = result.data
    const total = data.total
    if (typeof total === 'number') {
      const maxPage = Math.max(1, Math.ceil(total / tab.pageSize))
      if (tab.page > maxPage) {
        tab.page = maxPage
        return reloadDataTab(tab, options)
      }
      tab.total = total
    }
    const rows = data.rows
    tab.rows = rows
    tab.sourceRows = rows.map((row) => ({ ...row }))
    tab.rowCount = data.rowCount
    tab.durationMs = data.durationMs
    tab.knownColumns = data.knownColumns
    tab.columns = data.columns
    if (!preserveDirty) {
      tab.dirtyState = makeDirtyState(tab.rows, tab.primaryKey)
      tab.undoStack = []
      tab.selectedRowKey = null
      tab.saveError = null
      resetDataMutationPlan(tab)
    } else {
      tab.dirtyState = { ...tab.dirtyState, originalRows: makeOriginalRows(tab.rows, tab.primaryKey) }
      void refreshDataMutationPlan(tab)
    }
    if (options.notice) showNotice(options.notice)
  } catch (error) {
    tab.error = errorToMessage(error)
  } finally {
    tab.loading = false
  }
}

function queryDataTabThroughBackend(tab: Extract<WorkspaceTab, { kind: 'data' }>, withTotal: boolean): Promise<DatabaseTableQueryResult> {
  const connection = findConnection(tab.connectionId)
  return window.aiops.queryDatabaseTable({
    connectionId: tab.connectionId,
    dbType: connection?.dbType,
    databaseName: tab.catalogName,
    schemaName: tab.schemaName,
    tableName: tab.tableName,
    filters: tab.filters.map((filter) => ({ ...filter })),
    sort: tab.sort ? { ...tab.sort } : null,
    whereRaw: tab.whereRaw || null,
    orderByRaw: tab.orderByRaw || null,
    page: tab.page,
    pageSize: tab.pageSize,
    withTotal
  })
}

function parseWhereRaw(whereRaw: string): DbFilter[] {
  const raw = whereRaw.trim()
  if (!raw) return []
  const match = raw.match(/(\w+)\s*(=|<>|!=|like)\s*['"]?([^'"]+)['"]?/i)
  if (!match) return []
  return [
    {
      column: match[1],
      operator: match[2].toLowerCase() === 'like' ? 'like' : match[2] === '=' ? 'eq' : 'neq',
      value: match[3]
    }
  ]
}

function parseOrderByRaw(orderByRaw: string, knownColumns: string[]): DbOrderBy {
  const raw = orderByRaw.trim().replace(/^order\s+by\s+/i, '')
  if (!raw) return []
  const knownColumnMap = new Map(knownColumns.map((column) => [column.toLowerCase(), column]))
  return raw
    .split(',')
    .map((item) => item.trim())
    .map((item) => {
      const match = item.match(
        /^((?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*))*)(?:\s+(asc|desc))?(?:\s+nulls\s+(?:first|last))?$/i
      )
      if (!match) return null
      const column = normalizeOrderByIdentifier(match[1])
      const knownColumn = knownColumnMap.get(column.toLowerCase())
      if (!knownColumn) return null
      return {
        column: knownColumn,
        direction: (match[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc'
      }
    })
    .filter((item): item is DbOrderBy[number] => item !== null)
}

function normalizeOrderByIdentifier(value: string) {
  const segments = value.match(/`[^`]+`|"(?:""|[^"])+"|\[[^\]]+\]|[A-Za-z_][\w$]*/g)
  const segment = segments?.length ? segments[segments.length - 1] : value
  if (segment.startsWith('`') && segment.endsWith('`')) return segment.slice(1, -1).replace(/``/g, '`')
  if (segment.startsWith('"') && segment.endsWith('"')) return segment.slice(1, -1).replace(/""/g, '"')
  if (segment.startsWith('[') && segment.endsWith(']')) return segment.slice(1, -1).replace(/]]/g, ']')
  return segment
}

function makeDirtyState(rows: Array<Record<string, unknown>>, primaryKey: string[]): DirtyState {
  return {
    newRows: [],
    deletedRowKeys: new Set<string>(),
    updatedCells: new Map<string, Record<string, unknown>>(),
    originalRows: makeOriginalRows(rows, primaryKey)
  }
}

function makeOriginalRows(rows: Array<Record<string, unknown>>, primaryKey: string[]) {
  const originalRows = new Map<string, Record<string, unknown>>()
  rows.forEach((row, index) => {
    originalRows.set(buildRowKey(row, primaryKey, index), { ...row })
  })
  return originalRows
}

function isDataTabDirty(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  return tab.dirtyState.newRows.length > 0 || tab.dirtyState.deletedRowKeys.size > 0 || tab.dirtyState.updatedCells.size > 0
}

function cloneDirtyState(dirtyState: DirtyState): DirtyState {
  return {
    newRows: dirtyState.newRows.map((row) => ({ tmpId: row.tmpId, values: { ...row.values } })),
    deletedRowKeys: new Set(dirtyState.deletedRowKeys),
    updatedCells: new Map(Array.from(dirtyState.updatedCells.entries()).map(([key, patch]) => [key, { ...patch }])),
    originalRows: new Map(Array.from(dirtyState.originalRows.entries()).map(([key, row]) => [key, { ...row }]))
  }
}

function buildDataEditSummary(tab: Extract<WorkspaceTab, { kind: 'data' }>): DataEditSummary {
  const newRows = tab.dirtyState.newRows.length
  const updatedRows = tab.dirtyState.updatedCells.size
  const deletedRows = tab.dirtyState.deletedRowKeys.size
  const isDirty = newRows > 0 || updatedRows > 0 || deletedRows > 0
  const plan = isDirty ? tab.mutationPlan : makeDataMutationPlanState()
  return {
    isDirty,
    newRows,
    updatedRows,
    deletedRows,
    undoDepth: tab.undoStack.length,
    statementCount: plan.statementCount,
    preview: plan.preview,
    warning: plan.warning,
    error: plan.error
  }
}

function isViewTable(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  const catalog = findConnection(tab.connectionId)?.catalogs.find((item) => item.name === tab.catalogName)
  if (!catalog) return false
  if (tab.schemaName) {
    const schema = catalog.schemas?.find((item) => item.name === tab.schemaName)
    return !!schema?.views?.some((table) => table.id === tab.tableId)
  }
  return false
}

function applyFilters(rows: Array<Record<string, unknown>>, filters: DbFilter[]) {
  if (!filters.length) return rows
  return rows.filter((row) => filters.every((filter) => matchesFilter(row[filter.column], filter)))
}

function matchesFilter(value: unknown, filter: DbFilter) {
  const normalized = normalizeFilterValue(value)
  if (filter.operator === 'isnull') return normalized === null
  if (filter.operator === 'notnull') return normalized !== null
  if (normalized === null) return false
  if (filter.operator === 'like') return normalized.toLowerCase().includes(filter.value.toLowerCase())
  if (filter.operator === 'eq') return normalized === filter.value
  if (filter.operator === 'neq') return normalized !== filter.value
  if (filter.operator === 'in') return filter.values.includes(normalized)
  return true
}

function applySort(rows: Array<Record<string, unknown>>, sort: DbSort) {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const av = a[sort.column]
    const bv = b[sort.column]
    const factor = sort.direction === 'asc' ? 1 : -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
    return String(av ?? '').localeCompare(String(bv ?? '')) * factor
  })
}

function applyOrderBySort(rows: Array<Record<string, unknown>>, orderBy: DbOrderBy) {
  if (!orderBy.length) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const item of orderBy) {
        const result = compareDataValue(a.row[item.column], b.row[item.column])
        if (result !== 0) return item.direction === 'asc' ? result : -result
      }
      return a.index - b.index
    })
    .map((item) => item.row)
}

function compareDataValue(a: unknown, b: unknown) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const aTime = typeof a === 'string' ? Date.parse(a) : Number.NaN
  const bTime = typeof b === 'string' ? Date.parse(b) : Number.NaN
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function nextSort(current: DbSort, column: string): DbSort {
  if (!current || current.column !== column) return { column, direction: 'asc' }
  if (current.direction === 'asc') return { column, direction: 'desc' }
  return null
}

function replaceFilter(filters: DbFilter[], column: string, filter: DbFilter | null) {
  const next = filters.filter((item) => item.column !== column)
  return filter ? [...next, filter] : next
}

function distinctFilterValues(values: unknown[]): DbFilterValueEntry[] {
  const map = new Map<string, DbFilterValueEntry>()
  values.forEach((value) => {
    const normalized = normalizeFilterValue(value)
    const key = normalized ?? DB_FILTER_NULL
    const label = normalized === null ? '<null>' : normalized === '' ? '<empty>' : normalized
    const existing = map.get(key)
    if (existing) existing.count += 1
    else map.set(key, { value: key, label, count: 1 })
  })
  return Array.from(map.values()).sort((a, b) => {
    if (a.value === DB_FILTER_NULL) return -1
    if (b.value === DB_FILTER_NULL) return 1
    return a.label.localeCompare(b.label)
  })
}

function normalizeFilterValue(value: unknown) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function clampPage(page: number, total: number, pageSize: number) {
  const max = Math.max(1, Math.ceil(total / pageSize))
  return Math.min(Math.max(1, Math.floor(page)), max)
}

function buildRowKey(row: Record<string, unknown>, primaryKey: string[], index: number) {
  if (!primaryKey.length) return `row-${index}`
  return JSON.stringify(primaryKey.map((key) => row[key]))
}

function formatSql() {
  const tab = activeSqlTab.value
  if (!tab) return
  const range = getSqlSelectionRange()
  const hasSelection = range.start !== range.end
  const source = hasSelection ? tab.sql.slice(range.start, range.end) : tab.sql
  if (!source.trim()) {
    showNotice('SQL is empty')
    return
  }
  const formatted = formatSqlText(source)
  if (hasSelection) {
    const nextSql = `${tab.sql.slice(0, range.start)}${formatted}${tab.sql.slice(range.end)}`
    setEditorSql(nextSql, range.start, range.start + formatted.length)
  } else {
    setEditorSql(formatted, formatted.length)
  }
  showNotice('SQL formatted')
}

function formatSqlText(sql: string) {
  const normalized = sql
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, ';\n\n')
    .trim()
  const clauses = [
    'select',
    'from',
    'where',
    'group by',
    'having',
    'order by',
    'limit',
    'offset',
    'values',
    'set',
    'returning'
  ]
  let formatted = normalized
  clauses.forEach((clause) => {
    const keyword = clause.toUpperCase()
    const pattern = new RegExp(`\\b${clause.replace(' ', '\\s+')}\\b`, 'gi')
    formatted = formatted.replace(pattern, `\n${keyword}`)
  })
  formatted = formatted
    .replace(/^\n/, '')
    .replace(/\s*,\s*/g, ',\n  ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\nSELECT\s+/g, '\nSELECT\n  ')
    .replace(/^SELECT\s+/, 'SELECT\n  ')
    .replace(/\nFROM\s+/g, '\nFROM\n  ')
    .replace(/\nWHERE\s+/g, '\nWHERE\n  ')
    .replace(/\nGROUP BY\s+/g, '\nGROUP BY\n  ')
    .replace(/\nORDER BY\s+/g, '\nORDER BY\n  ')
    .replace(/\nLIMIT\s+/g, '\nLIMIT ')
    .replace(/\nOFFSET\s+/g, '\nOFFSET ')
    .replace(/\n\n+/g, '\n\n')
    .trim()
  return formatted.endsWith(';') ? formatted : `${formatted};`
}

async function toggleConnectionStatus(id: string) {
  const connection = findConnection(id)
  if (!connection) return
  if (connection.status === 'connected') {
    const result = await disconnectDatabaseConnectionViaBackend(id)
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database disconnect failed.',
        (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId: id, status: 'idle' }),
        DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    expandedConnections.value = expandedConnections.value.filter((item) => item !== id)
    return
  }
  const result = await connectDatabaseConnectionViaBackend(id)
  if (
    !applyDatabaseCatalogMutationResult(
      result,
      'Database connection failed.',
      (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId: id, status: 'connected' }),
      DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
    )
  ) {
    return
  }
  expandedConnections.value = Array.from(new Set([...expandedConnections.value, id]))
}

async function refreshConnected() {
  const connected = connections.value.filter((connection) => connection.status === 'connected')
  if (!connected.length) {
    showNotice('No connected database schemas to refresh')
    return
  }
  for (const connection of connected) {
    const result = await refreshDatabaseConnectionViaBackend(connection.id)
    const wasExpanded = expandedConnections.value.includes(connection.id)
    if (
      !applyDatabaseCatalogMutationResult(
        result,
        'Database connection refresh failed.',
        (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId: connection.id }),
        DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
      )
    ) {
      return
    }
    if (wasExpanded) expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
  }
  showNotice('Connected database schemas refreshed')
}

function toggleAddMenu() {
  if (addMenuOpen.value) {
    addMenuOpen.value = false
    return
  }
  const rect = addButtonRef.value?.getBoundingClientRect()
  addMenuPosition.value = {
    x: rect ? rect.right - 160 : 80,
    y: rect ? rect.bottom + 6 : 44
  }
  contextMenu.value = null
  addMenuOpen.value = true
}

function focusDatabaseSearch() {
  sidebarCollapsed.value = false
  keyword.value = ''
  nextTick(() => searchInputRef.value?.focus())
}

function clearDatabaseSearch() {
  keyword.value = ''
  nextTick(() => searchInputRef.value?.focus())
}

function openOverviewEngine(engine: DatabaseEngineInfo) {
  if (!isConnectableDatabaseEngineInfo(engine)) {
    showNotice(`${engine.name} connection is unavailable`)
    return
  }
  openConnectionModalFromEngine(engine)
}

function openConnectionModalFromEngine(engine: DatabaseEngineInfo, groupId?: string) {
  if (!isConnectableDatabaseEngineInfo(engine)) {
    showNotice(`${engine.name} connection is unavailable`)
    return
  }
  openConnectionModal(engine.connectionCode, groupId)
}

async function addGroup(parentGroupId: string | null = null) {
  const result = await createDatabaseGroupViaBackend({ name: 'New Group', parentId: parentGroupId })
  const data = databaseCatalogMutationData(
    result,
    'Database group create failed.',
    (value): value is NonNullable<DatabaseGroupMutationResult['data']> => isDatabaseGroupMutationDataForRequest(value, { name: 'New Group', parentId: parentGroupId }),
    DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
  )
  if (!data) return
  applyDatabaseCatalog(data)
  expandedGroups.value = Array.from(new Set([...expandedGroups.value, data.group.id, ...(parentGroupId ? [parentGroupId] : [])]))
  selectedNodeId.value = data.group.id
  editingGroupId.value = data.group.id
  editingGroupName.value = 'New Group'
  closeMenus()
}

function startGroupRename(groupId: string) {
  const group = groups.value.find((item) => item.id === groupId)
  if (!group) return
  editingGroupId.value = groupId
  editingGroupName.value = group.name
  closeMenus()
}

async function commitGroupRename() {
  const id = editingGroupId.value
  if (!id) return
  const name = editingGroupName.value.trim()
  editingGroupId.value = null
  editingGroupName.value = ''
  if (name) {
    const result = await renameDatabaseGroupViaBackend({ id, name })
    applyDatabaseCatalogMutationResult(
      result,
      'Database group rename failed.',
      (value): value is NonNullable<DatabaseGroupMutationResult['data']> => isDatabaseGroupMutationDataForRequest(value, { id, name }),
      DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
    )
  }
}

function cancelGroupRename() {
  editingGroupId.value = null
  editingGroupName.value = ''
}

function requestDeleteGroup(groupId: string) {
  if (groupId === DEFAULT_GROUP_ID) {
    showNotice('Default Group cannot be deleted')
    closeMenus()
    return
  }
  const group = groups.value.find((item) => item.id === groupId)
  if (!group) return
  operationConfirm.open = true
  operationConfirm.action = 'deleteGroup'
  operationConfirm.targetId = groupId
  operationConfirm.title = 'Delete Group'
  operationConfirm.message = `Delete group "${group.name}"? Child groups move to root and connections move to Default Group in the database workspace catalog.`
  operationConfirm.detail = group.name
  operationConfirm.confirmLabel = 'Delete'
  closeMenus()
}

async function deleteGroup(groupId: string) {
  const result = await deleteDatabaseGroupViaBackend(groupId)
  if (
    !applyDatabaseCatalogMutationResult(
      result,
      'Database group delete failed.',
      (value): value is NonNullable<DatabaseGroupDeleteResult['data']> => isDatabaseGroupDeleteDataForRequest(value, groupId),
      DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
    )
  ) {
    return
  }
  selectedNodeId.value = groups.value.find((group) => group.id === DEFAULT_GROUP_ID)?.id ?? groups.value[0]?.id ?? null
  closeMenus()
}

async function moveGroupTo(groupId: string, parentId: string | null) {
  if (groupId === DEFAULT_GROUP_ID) {
    showNotice('Default Group cannot be moved')
    closeMenus()
    return
  }
  if (parentId === groupId || (parentId && collectDescendantGroupIds(groupId).has(parentId))) return
  const result = await moveDatabaseGroupViaBackend({ id: groupId, parentId })
  if (
    !applyDatabaseCatalogMutationResult(
      result,
      'Database group move failed.',
      (value): value is NonNullable<DatabaseGroupMutationResult['data']> => isDatabaseGroupMutationDataForRequest(value, { id: groupId, parentId }),
      DATABASE_GROUP_MUTATION_MALFORMED_MESSAGE
    )
  ) {
    return
  }
  if (parentId) expandedGroups.value = Array.from(new Set([...expandedGroups.value, parentId]))
  showNotice(parentId ? `Group moved to ${groupPathLabel(parentId)}` : 'Group moved to root')
  closeMenus()
}

function openContextMenu(event: MouseEvent, payload: ContextMenuPayload) {
  selectedNodeId.value =
    payload.type === 'group' ? payload.groupId : payload.type === 'connection' ? payload.connectionId : payload.tableId
  addMenuOpen.value = false
  contextSubmenu.value = null
  contextMenu.value = { ...payload, x: event.clientX, y: event.clientY } as ContextMenu
}

async function connectFromMenu(connectionId: string) {
  const connectionBefore = findConnection(connectionId)
  if (!connectionBefore) return
  const result =
    connectionBefore.status === 'connected' ? await disconnectDatabaseConnectionViaBackend(connectionId) : await connectDatabaseConnectionViaBackend(connectionId)
  if (
    !applyDatabaseCatalogMutationResult(
      result,
      connectionBefore.status === 'connected' ? 'Database disconnect failed.' : 'Database connection failed.',
      (value): value is NonNullable<DatabaseConnectionMutationResult['data']> =>
        isDatabaseConnectionMutationDataForRequest(value, { connectionId, status: connectionBefore.status === 'connected' ? 'idle' : 'connected' }),
      DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
    )
  ) {
    return
  }
  const connection = findConnection(connectionId)
  if (connection?.status === 'connected') {
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, connectionId]))
  } else {
    expandedConnections.value = expandedConnections.value.filter((item) => item !== connectionId)
  }
  showNotice(connection?.status === 'connected' ? 'Connection opened' : 'Connection closed')
  closeMenus()
}

async function moveConnectionToGroup(connectionId: string, groupId: string) {
  const connection = findConnection(connectionId)
  if (!connection || connection.groupId === groupId) return
  const result = await moveDatabaseConnectionViaBackend({ connectionId, groupId })
  if (
    !applyDatabaseCatalogMutationResult(
      result,
      'Database connection move failed.',
      (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId, groupId }),
      DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
    )
  ) {
    return
  }
  expandedGroups.value = Array.from(new Set([...expandedGroups.value, groupId]))
  showNotice(groupId === DEFAULT_GROUP_ID ? 'Connection moved to root group' : `Connection moved to ${groupPathLabel(groupId)}`)
  closeMenus()
}

function applyConnectionRefreshUi(connectionId: string, options: { preserveExpanded?: boolean; forceExpand?: boolean; notice?: string } = {}) {
  const connection = findConnection(connectionId)
  if (!connection) return
  const wasExpanded = expandedConnections.value.includes(connectionId)
  const shouldExpand = options.forceExpand ? true : wasExpanded
  if (shouldExpand) {
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, connectionId]))
  }
  const validCatalogNames = new Set(connection.catalogs.map((catalog) => catalog.name))
  expandedCatalogs.value = expandedCatalogs.value.filter((id) => {
    if (!id.startsWith(`${connectionId}:`)) return true
    const [, catalogName] = id.split(':')
    return shouldExpand && validCatalogNames.has(catalogName)
  })
  expandedSchemas.value = expandedSchemas.value.filter((id) => {
    if (!id.startsWith(`${connectionId}:`)) return true
    const [, catalogName, schemaName] = id.split(':')
    const catalog = connection.catalogs.find((item) => item.name === catalogName)
    return shouldExpand && !!catalog?.schemas?.some((schema) => schema.name === schemaName)
  })
  expandedSchemaObjectFolders.value = expandedSchemaObjectFolders.value.filter((id) => {
    if (!id.startsWith(`${connectionId}:`)) return true
    const [, catalogName, schemaName, kind] = id.split(':')
    const catalog = connection.catalogs.find((item) => item.name === catalogName)
    return shouldExpand && !!catalog?.schemas?.some((schema) => schema.name === schemaName) && ['tables', 'views', 'functions', 'procedures'].includes(kind)
  })
  repairTabsForConnection(connectionId)
  if (selectedNodeId.value === connectionId || shouldExpand) selectedNodeId.value = connectionId
  if (options.notice !== '') showNotice(options.notice ?? 'Connection schema refreshed')
}

async function refreshConnectionFromMenu(connectionId: string) {
  const connection = findConnection(connectionId)
  if (!connection) return
  const wasExpanded = expandedConnections.value.includes(connectionId)
  const result = await refreshDatabaseConnectionViaBackend(connectionId)
  if (
    !applyDatabaseCatalogMutationResult(
      result,
      'Database connection refresh failed.',
      (value): value is NonNullable<DatabaseConnectionMutationResult['data']> => isDatabaseConnectionMutationDataForRequest(value, { connectionId }),
      DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE
    )
  ) {
    return
  }
  applyConnectionRefreshUi(connectionId, { preserveExpanded: wasExpanded, notice: 'Connection schema refreshed' })
  closeMenus()
}

function editConnection(connectionId: string) {
  const connection = findConnection(connectionId)
  if (!connection) return
  connectionModalMode.value = 'edit'
  Object.assign(connectionDraft, {
    id: connection.id,
    dbType: connection.dbType,
    name: connection.name,
    env: connection.env,
    groupId: connection.groupId,
    host: connection.host,
    port: connection.port,
    authentication: connection.authentication,
    user: connection.user,
    password: '',
    database: connection.database,
    filePath: connection.filePath ?? '',
    readonly: !!connection.readonly,
    sslMode: connection.sslMode ?? '',
    needProxy: !!connection.needProxy,
    proxyName: connection.proxyName ?? '',
    url: connection.url ?? ''
  })
  connectionErrors.value = []
  connectionFeedback.value = ''
  connectionFeedbackKind.value = 'info'
  connectionUrlDirty.value = !!(connection.url && connection.url !== buildConnectionUrl())
  passwordVisible.value = false
  connectionTesting.value = false
  connectionSaving.value = false
  connectionModalOpen.value = true
  closeMenus()
}

function requestRemoveConnection(connectionId: string) {
  const connection = findConnection(connectionId)
  if (!connection) return
  const relatedTabCount = tabs.value.filter((tab) => tab.kind !== 'overview' && tab.connectionId === connectionId).length
  operationConfirm.open = true
  operationConfirm.action = 'removeConnection'
  operationConfirm.targetId = connectionId
  operationConfirm.title = 'Remove Connection'
  operationConfirm.message = `Remove connection "${connection.name}"?${relatedTabCount ? ` ${relatedTabCount} related workspace tab${relatedTabCount > 1 ? 's' : ''} will close.` : ''}`
  operationConfirm.detail = connection.name
  operationConfirm.confirmLabel = 'Remove'
  closeMenus()
}

async function removeConnection(connectionId: string) {
  const removedTabIds = new Set(tabs.value.filter((tab) => tab.kind !== 'overview' && tab.connectionId === connectionId).map((tab) => tab.id))
  const result = await removeDatabaseConnectionViaBackend(connectionId)
  if (!result.ok) {
    showNotice(result.errorMessage || 'Database connection remove failed.')
    return
  }
  if (!isDatabaseConnectionDeleteDataForRequest(result.data, connectionId)) {
    showNotice(DATABASE_CONNECTION_MUTATION_MALFORMED_MESSAGE)
    return
  }
  applyDatabaseCatalog(result.data)
  expandedConnections.value = expandedConnections.value.filter((id) => id !== connectionId)
  expandedCatalogs.value = expandedCatalogs.value.filter((id) => !id.startsWith(`${connectionId}:`))
  expandedSchemas.value = expandedSchemas.value.filter((id) => !id.startsWith(`${connectionId}:`))
  expandedSchemaObjectFolders.value = expandedSchemaObjectFolders.value.filter((id) => !id.startsWith(`${connectionId}:`))
  tabs.value = tabs.value.filter((tab) => !removedTabIds.has(tab.id))
  if (removedTabIds.has(activeTabId.value)) activeTabId.value = tabs.value[0]?.id ?? 'tab-overview'
  showNotice(result.data.message || 'Connection removed')
  closeMenus()
}

function openContextTable() {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  const table = findTable(menu.connectionId, menu.catalogName, menu.tableId, menu.schemaName)
  if (table) openTable(menu.connectionId, menu.catalogName, table, menu.schemaName)
  closeMenus()
}

function openContextSql() {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  const connection = findConnection(menu.connectionId)
  openSqlConsole(menu.connectionId)
  const tab = activeSqlTab.value
  if (tab) {
    tab.catalogName = menu.catalogName
    tab.schemaName = menu.schemaName ?? ''
    tab.tableId = menu.tableId
    tab.tableName = menu.label
    const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', menu.catalogName, menu.schemaName, menu.label)
    tab.sql =
      connection?.dbType === 'oracle'
        ? `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;`
        : connection?.dbType === 'sqlserver'
          ? `SELECT TOP (100) *\nFROM ${qualified};`
          : `SELECT *\nFROM ${qualified}\nLIMIT 100;`
  }
  closeMenus()
}

async function openDdlModalFromContext() {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  ddlModal.open = true
  ddlModal.tableName = menu.label
  ddlModal.ddl = ''
  ddlModal.connectionId = menu.connectionId
  ddlModal.catalogName = menu.catalogName
  ddlModal.schemaName = menu.schemaName ?? ''
  ddlModal.tableId = menu.tableId
  ddlModal.loading = true
  ddlModal.error = ''
  ddlModal.errorCode = ''
  closeMenus()
  const result = await fetchTableDdl({
    connectionId: menu.connectionId,
    catalogName: menu.catalogName,
    schemaName: menu.schemaName,
    tableId: menu.tableId,
    tableName: menu.label
  })
  ddlModal.loading = false
  if (result.ok) {
    ddlModal.ddl = result.ddl
    return
  }
  ddlModal.errorCode = result.errorCode === 'permission' ? 'permission' : 'other'
  ddlModal.error = formatDdlError(result)
  showNotice(ddlModal.error)
}

function fetchTableDdl(ctx: {
  connectionId: string
  catalogName: string
  schemaName?: string
  tableId: string
  tableName: string
}): Promise<TableDdlResult> {
  const getTableDdl = window.aiops?.getDatabaseTableDdl
  if (typeof getTableDdl !== 'function') {
    return Promise.resolve({ ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database DDL API is unavailable.' })
  }
  const connection = findConnection(ctx.connectionId)
  return getTableDdl({
    connectionId: ctx.connectionId,
    dbType: connection?.dbType,
    databaseName: ctx.catalogName,
    schemaName: ctx.schemaName,
    tableName: ctx.tableName
  })
    .then(normalizeTableDdlResult)
    .catch((error) => ({ ok: false, errorCode: 'other', errorMessage: errorToMessage(error) }))
}

function normalizeTableDdlResult(result: DatabaseTableDdlResult): TableDdlResult {
  if (result.ok) {
    const ddl = typeof result.data?.ddl === 'string' ? result.data.ddl : ''
    if (!ddl.trim()) return { ok: false, errorCode: 'other', errorMessage: 'Database DDL backend returned malformed result data.' }
    return { ok: true, ddl }
  }
  return { ok: false, errorCode: result.errorCode || 'other', errorMessage: result.errorMessage || 'DDL fetch failed.' }
}

function formatDdlError(result: Extract<TableDdlResult, { ok: false }>) {
  if (result.errorCode === 'permission') return `DDL permission denied: ${result.errorMessage}`
  return `DDL fetch failed: ${result.errorMessage}`
}

async function copySelectSql() {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  const connection = findConnection(menu.connectionId)
  const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', menu.catalogName, menu.schemaName, menu.label)
  if (await copyText(`SELECT * FROM ${qualified}`)) showNotice('SELECT copied')
  closeMenus()
}

async function copyTableDdlFromContext() {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  const result = await fetchTableDdl({
    connectionId: menu.connectionId,
    catalogName: menu.catalogName,
    schemaName: menu.schemaName,
    tableId: menu.tableId,
    tableName: menu.label
  })
  if (!result.ok) {
    showNotice(formatDdlError(result))
    closeMenus()
    return
  }
  if (await copyText(result.ddl)) showNotice('DDL copied')
  closeMenus()
}

function requestDangerousTableAction(action: 'drop' | 'truncate') {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  const qualified = `${menu.schemaName ? `${menu.schemaName}.` : ''}${menu.label}`
  Object.assign(dangerConfirm, {
    open: true,
    action,
    connectionId: menu.connectionId,
    catalogName: menu.catalogName,
    schemaName: menu.schemaName ?? '',
    tableId: menu.tableId,
    tableName: menu.label,
    sql: action === 'drop' ? `DROP TABLE ${qualified};` : `TRUNCATE TABLE ${qualified};`,
    confirmText: ''
  })
  closeMenus()
}

function cancelDangerousTableAction() {
  dangerConfirm.open = false
  dangerConfirm.confirmText = ''
}

async function confirmDangerousTableAction() {
  if (!dangerConfirm.open || dangerConfirm.confirmText !== dangerConfirm.tableName) return
  const connection = findConnection(dangerConfirm.connectionId)
  const context = [connection?.name, dangerConfirm.catalogName, dangerConfirm.schemaName, dangerConfirm.tableName].filter(Boolean).join(' · ')
  openDbAi(dangerConfirm.action, dangerConfirm.sql, context, {
    connectionId: dangerConfirm.connectionId,
    dbType: connection?.dbType ?? '',
    databaseName: dangerConfirm.catalogName,
    schemaName: dangerConfirm.schemaName || undefined,
    tableName: dangerConfirm.tableName,
    contextSummary: context
  })
  const ok = dangerConfirm.action === 'truncate' ? await applyBackendTableTruncate() : await applyBackendTableDrop()
  if (ok) {
    dangerConfirm.open = false
    dangerConfirm.confirmText = ''
  }
}

async function applyBackendTableTruncate() {
  const table = findTable(dangerConfirm.connectionId, dangerConfirm.catalogName, dangerConfirm.tableId, dangerConfirm.schemaName || undefined)
  if (!table) return false
  const result = await window.aiops.mutateDatabaseTable({
    connectionId: dangerConfirm.connectionId,
    databaseName: dangerConfirm.catalogName,
    schemaName: dangerConfirm.schemaName || undefined,
    tableName: dangerConfirm.tableName,
    mutations: [{ kind: 'truncate' }]
  })
  if (!result.ok) {
    showNotice(result.errorMessage || 'Backend table truncate failed')
    return false
  }
  if (!isDatabaseTableMutationData(result.data)) {
    showNotice(DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE)
    return false
  }
  tabs.value.forEach((tab) => {
    if (
      tab.kind === 'data' &&
      tableContextMatches(tab, {
        connectionId: dangerConfirm.connectionId,
        catalogName: dangerConfirm.catalogName,
        schemaName: dangerConfirm.schemaName,
        tableId: dangerConfirm.tableId,
        tableName: dangerConfirm.tableName
      })
    ) {
      void reloadDataTab(tab, { withTotal: tab.total !== null, preserveDirty: false, notice: 'Table truncated through backend table store' })
    }
  })
  showNotice('Table truncated through backend table store')
  return true
}

async function applyBackendTableDrop() {
  const table = findTable(dangerConfirm.connectionId, dangerConfirm.catalogName, dangerConfirm.tableId, dangerConfirm.schemaName || undefined)
  if (!table) return false
  const droppedContext = {
    connectionId: dangerConfirm.connectionId,
    catalogName: dangerConfirm.catalogName,
    schemaName: dangerConfirm.schemaName,
    tableId: dangerConfirm.tableId,
    tableName: dangerConfirm.tableName
  }
  const removedTabIds = new Set(
    tabs.value
      .filter((tab) => tab.kind !== 'overview' && tableContextMatches(tab, droppedContext))
      .map((tab) => tab.id)
  )
  const closeDdlModal =
    ddlModal.open &&
    ddlModal.connectionId === droppedContext.connectionId &&
    ddlModal.catalogName === droppedContext.catalogName &&
    (ddlModal.schemaName || '') === (droppedContext.schemaName || '') &&
    (ddlModal.tableId === droppedContext.tableId || ddlModal.tableName === droppedContext.tableName)
  const result = await window.aiops.mutateDatabaseTable({
    connectionId: dangerConfirm.connectionId,
    databaseName: dangerConfirm.catalogName,
    schemaName: dangerConfirm.schemaName || undefined,
    tableName: dangerConfirm.tableName,
    mutations: [{ kind: 'drop' }]
  })
  if (!result.ok) {
    showNotice(result.errorMessage || 'Backend table drop failed')
    return false
  }
  if (!isDatabaseTableMutationData(result.data, { requireCatalog: true })) {
    showNotice(DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE)
    return false
  }
  if (!result.data.catalog) {
    showNotice(DATABASE_TABLE_MUTATION_MALFORMED_MESSAGE)
    return false
  }
  applyDatabaseCatalog(result.data.catalog)
  cleanupDroppedTableUi(droppedContext, removedTabIds, closeDdlModal)
  showNotice('Table dropped through backend table store')
  return true
}

function cleanupDroppedTableUi(
  droppedContext: { connectionId: string; catalogName: string; schemaName?: string; tableId: string; tableName: string },
  removedTabIds: Set<string>,
  closeDdlModal: boolean
) {
  tabs.value = tabs.value.filter((tab) => !removedTabIds.has(tab.id))
  if (removedTabIds.has(activeTabId.value)) activeTabId.value = tabs.value[0]?.id ?? 'tab-overview'
  expandedTables.value = expandedTables.value.filter((id) => id !== droppedContext.tableId)
  if (closeDdlModal) ddlModal.open = false
  const parentNodeId = droppedContext.schemaName
    ? `${droppedContext.connectionId}:${droppedContext.catalogName}:${droppedContext.schemaName}`
    : `${droppedContext.connectionId}:${droppedContext.catalogName}`
  if (
    databaseNodeExists(parentNodeId) &&
    (selectedNodeId.value === droppedContext.tableId || selectedNodeId.value?.startsWith(`${droppedContext.tableId}:column:`))
  ) {
    selectedNodeId.value = parentNodeId
  }
}

function cancelOperationConfirm() {
  operationConfirm.open = false
  operationConfirm.action = ''
  operationConfirm.targetId = ''
  operationConfirm.title = ''
  operationConfirm.message = ''
  operationConfirm.detail = ''
  operationConfirm.confirmLabel = 'Delete'
}

async function confirmOperation() {
  const action = operationConfirm.action
  const targetId = operationConfirm.targetId
  cancelOperationConfirm()
  if (action === 'deleteGroup') {
    await deleteGroup(targetId)
    return
  }
  if (action === 'removeConnection') {
    await removeConnection(targetId)
  }
}

async function copyContextName() {
  if (!contextMenu.value) return
  if (await copyText(contextMenu.value.label)) showNotice('Name copied')
  closeMenus()
}

function openConnectionModal(dbType: DatabaseEngineCode, groupId = groups.value[0]?.id ?? 'group-default') {
  connectionModalMode.value = 'create'
  const defaultPort =
    dbType === 'postgresql'
      ? 5432
      : dbType === 'kingbase'
        ? 54321
        : dbType === 'oceanbase'
          ? 2881
          : dbType === 'oracle'
            ? 1521
            : dbType === 'sqlserver'
              ? 1433
              : dbType === 'clickhouse'
                ? 8123
                : dbType === 'presto'
                  ? 8080
                  : dbType === 'sqlite'
                    ? null
                    : 3306
  Object.assign(connectionDraft, {
    id: '',
    dbType,
    name: `${engineName(dbType).toLowerCase()}-connection`,
    env: 'Development',
    groupId,
    host: '127.0.0.1',
    port: defaultPort,
    authentication: 'UserAndPassword',
    user: dbType === 'sqlite' ? '' : dbType === 'sqlserver' ? 'sa' : dbType === 'clickhouse' ? 'default' : dbType === 'presto' ? 'presto' : 'root',
    password: '',
    database: '',
    filePath: '',
    readonly: dbType === 'sqlite',
    sslMode: '',
    needProxy: false,
    proxyName: '',
    url: ''
  })
  connectionErrors.value = []
  connectionFeedback.value = ''
  connectionFeedbackKind.value = 'info'
  connectionUrlDirty.value = false
  passwordVisible.value = false
  connectionTesting.value = false
  connectionSaving.value = false
  connectionModalOpen.value = true
  closeMenus()
}

function closeConnectionModal() {
  connectionModalOpen.value = false
  connectionFeedback.value = ''
  connectionFeedbackKind.value = 'info'
  connectionErrors.value = []
  connectionUrlDirty.value = false
  passwordVisible.value = false
  connectionTesting.value = false
  connectionSaving.value = false
}

async function pickSqliteFile() {
  const showOpenDialog = window.aiops?.showOpenDialog
  if (typeof showOpenDialog !== 'function') {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = 'SQLite file picker service is unavailable.'
    return
  }
  let result: Awaited<ReturnType<typeof showOpenDialog>>
  try {
    result = await showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
  } catch {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = 'SQLite file picker failed.'
    return
  }
  const filePath = result && !result.canceled ? result.filePaths?.[0] : ''
  if (!filePath) return
  connectionDraft.filePath = filePath
  connectionDraft.url = `sqlite://${filePath}`
  connectionUrlDirty.value = true
  clearConnectionFeedback()
}

function validateConnectionDraft() {
  const errors: string[] = []
  if (!connectionDraft.name.trim()) errors.push('name')
  if (connectionDraft.dbType === 'sqlite') {
    if (!connectionDraft.filePath.trim()) errors.push('filePath')
  } else {
    const hasOracleConnectString = connectionDraft.dbType === 'oracle' && !!connectionDraft.url.trim()
    const hasHost = !!connectionDraft.host.trim()
    const hasPort = typeof connectionDraft.port === 'number' && Number.isFinite(connectionDraft.port) && connectionDraft.port > 0
    if (connectionDraft.dbType !== 'oracle' || !hasOracleConnectString) {
      if (!hasHost) errors.push('host')
      if (!hasPort) errors.push('port')
    }
    if (!connectionDraft.user.trim()) errors.push('user')
    if (connectionDraft.needProxy && (!connectionDraft.proxyName.trim() || !databaseSshProxyNames.value.has(connectionDraft.proxyName.trim()))) {
      errors.push('proxyName')
    }
  }
  connectionErrors.value = errors
  return errors.length === 0
}

async function testConnectionDraft() {
  if (connectionTesting.value || connectionSaving.value) return
  if (!validateConnectionDraft()) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = 'Fix required fields before testing.'
    return
  }
  connectionTesting.value = true
  connectionFeedbackKind.value = 'info'
  connectionFeedback.value = 'Testing connection through local backend...'
  await nextTick()
  const result = await testConnectionDraftViaBackend()
  connectionTesting.value = false
  if (!result.ok) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = databaseConnectionResultMessage(result)
    return
  }
  if (!isDatabaseConnectionTestData(result.data)) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
    return
  }
  connectionFeedbackKind.value = 'info'
  connectionFeedback.value = `Connection successful. (${databaseConnectionResultMessage(result)})`
}

function databaseConnectionTestInput(): DatabaseConnectionTestInput {
  return {
    dbType: connectionDraft.dbType,
    name: connectionDraft.name,
    host: connectionDraft.host,
    port: connectionDraft.port,
    user: connectionDraft.user,
    password: connectionDraft.password,
    database: connectionDraft.database,
    filePath: connectionDraft.filePath,
    readonly: connectionDraft.readonly,
    sslMode: connectionDraft.sslMode,
    needProxy: connectionDraft.dbType !== 'sqlite' && connectionDraft.needProxy,
    proxyName: connectionDraft.dbType !== 'sqlite' && connectionDraft.needProxy ? connectionDraft.proxyName.trim() : '',
    url: connectionDraft.url || connectionUrl.value
  }
}

function databaseConnectionResultMessage(result: DatabaseConnectionTestResult) {
  if (!result.ok) return result.errorMessage || 'Database connection test failed.'
  if (!isDatabaseConnectionTestData(result.data)) return DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
  return result.data.serverVersion
}

async function testConnectionDraftViaBackend(): Promise<DatabaseConnectionTestResult> {
  if (!window.aiops?.testDatabaseConnection) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection test API is unavailable.' }
  }
  return window.aiops.testDatabaseConnection(databaseConnectionTestInput())
}

async function saveConnectionDraft() {
  if (connectionTesting.value || connectionSaving.value) return
  if (!validateConnectionDraft()) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = 'Fix required fields before saving.'
    return
  }
  connectionSaving.value = true
  connectionFeedbackKind.value = 'info'
  connectionFeedback.value = 'Saving connection through local backend...'
  await nextTick()
  const testResult = await testConnectionDraftViaBackend()
  if (!testResult.ok) {
    connectionSaving.value = false
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = databaseConnectionResultMessage(testResult)
    return
  }
  if (!isDatabaseConnectionTestData(testResult.data)) {
    connectionSaving.value = false
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
    return
  }
  const saveInput = databaseConnectionSaveInput()
  const saveResult = await saveConnectionDraftViaBackend(saveInput)
  connectionSaving.value = false
  if (!saveResult.ok) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = saveResult.errorMessage || 'Database connection save failed.'
    return
  }
  if (!isDatabaseConnectionSaveDataForRequest(saveResult.data, saveInput)) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = DATABASE_CONNECTION_SAVE_MALFORMED_MESSAGE
    return
  }
  applyDatabaseCatalog(saveResult.data)
  selectedNodeId.value = saveResult.data.connection.id
  expandedConnections.value = Array.from(new Set([...expandedConnections.value, saveResult.data.connection.id]))
  closeConnectionModal()
  showNotice(saveResult.data.message || 'Connection saved')
}

function databaseConnectionSaveInput(): DatabaseConnectionSaveInput {
  return {
    mode: connectionModalMode.value,
    id: connectionDraft.id || undefined,
    connection: {
      ...databaseConnectionTestInput(),
      env: connectionDraft.env,
      groupId: connectionDraft.groupId,
      authentication: connectionDraft.authentication
    }
  }
}

async function saveConnectionDraftViaBackend(input = databaseConnectionSaveInput()): Promise<DatabaseConnectionSaveResult> {
  if (!window.aiops?.saveDatabaseConnection) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection save API is unavailable.' }
  }
  return window.aiops.saveDatabaseConnection(input)
}

async function createDatabaseGroupViaBackend(input: DatabaseGroupCreateInput): Promise<DatabaseGroupMutationResult> {
  if (!window.aiops?.createDatabaseGroup) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group create API is unavailable.' }
  }
  return window.aiops.createDatabaseGroup(input)
}

async function renameDatabaseGroupViaBackend(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
  if (!window.aiops?.renameDatabaseGroup) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group rename API is unavailable.' }
  }
  return window.aiops.renameDatabaseGroup(input)
}

async function moveDatabaseGroupViaBackend(input: DatabaseGroupUpdateInput): Promise<DatabaseGroupMutationResult> {
  if (!window.aiops?.moveDatabaseGroup) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group move API is unavailable.' }
  }
  return window.aiops.moveDatabaseGroup(input)
}

async function deleteDatabaseGroupViaBackend(id: string): Promise<DatabaseGroupDeleteResult> {
  if (!window.aiops?.deleteDatabaseGroup) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database group delete API is unavailable.' }
  }
  return window.aiops.deleteDatabaseGroup(id)
}

async function moveDatabaseConnectionViaBackend(input: DatabaseConnectionMoveInput): Promise<DatabaseConnectionMutationResult> {
  if (!window.aiops?.moveDatabaseConnection) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection move API is unavailable.' }
  }
  return window.aiops.moveDatabaseConnection(input)
}

async function removeDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionDeleteResult> {
  if (!window.aiops?.removeDatabaseConnection) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection remove API is unavailable.' }
  }
  return window.aiops.removeDatabaseConnection(connectionId)
}

async function connectDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  if (!window.aiops?.connectDatabaseConnection) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database connection API is unavailable.' }
  }
  return window.aiops.connectDatabaseConnection(connectionId)
}

async function disconnectDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  if (!window.aiops?.disconnectDatabaseConnection) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database disconnect API is unavailable.' }
  }
  return window.aiops.disconnectDatabaseConnection(connectionId)
}

async function refreshDatabaseConnectionViaBackend(connectionId: string): Promise<DatabaseConnectionMutationResult> {
  if (!window.aiops?.refreshDatabaseConnection) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database refresh API is unavailable.' }
  }
  return window.aiops.refreshDatabaseConnection(connectionId)
}

function openCreateDatabaseModal(connectionId: string) {
  const connection = findConnection(connectionId)
  if (!connection || (!isMysqlCompatibleDbType(connection.dbType) && !isPostgresCompatibleDbType(connection.dbType) && connection.dbType !== 'sqlserver')) return
  createDatabaseModal.open = true
  createDatabaseModal.connectionId = connectionId
  createDatabaseModal.dbType = connection.dbType
  createDatabaseModal.name = ''
  createDatabaseModal.sql = ''
  createDatabaseModal.userEditedSql = false
  createDatabaseModal.lastAppliedTemplate = ''
  createDatabaseModal.submitting = false
  createDatabaseModal.feedback = ''
  createDatabaseModal.feedbackKind = 'info'
  closeMenus()
}

function closeCreateDatabaseModal() {
  createDatabaseModal.open = false
  createDatabaseModal.connectionId = ''
  createDatabaseModal.name = ''
  createDatabaseModal.sql = ''
  createDatabaseModal.userEditedSql = false
  createDatabaseModal.lastAppliedTemplate = ''
  createDatabaseModal.submitting = false
  createDatabaseModal.feedback = ''
  createDatabaseModal.feedbackKind = 'info'
}

async function createDatabase() {
  const connection = findConnection(createDatabaseModal.connectionId)
  if (!connection) return
  if (!createDatabaseCanSubmit.value) {
    createDatabaseModal.feedbackKind = 'error'
    createDatabaseModal.feedback = 'Fix the database name and SQL before creating.'
    return
  }
  const name = parseCreateDatabaseName(createDatabaseModal.sql) || createDatabaseModal.name.trim()
  if (connection.catalogs.some((catalog) => catalog.name.toLowerCase() === name.toLowerCase())) {
    createDatabaseModal.feedbackKind = 'error'
    createDatabaseModal.feedback = 'Database already exists.'
    return
  }
  createDatabaseModal.submitting = true
  const result = await createDatabaseViaBackend(createDatabaseModal.connectionId, createDatabaseModal.sql, name)
  createDatabaseModal.submitting = false
  if (!result.ok) {
    createDatabaseModal.feedbackKind = 'error'
    createDatabaseModal.feedback = result.errorMessage || 'Create database failed.'
    return
  }
  if (!isDatabaseCreateDatabaseDataForRequest(result.data, createDatabaseModal.connectionId, name)) {
    createDatabaseModal.feedbackKind = 'error'
    createDatabaseModal.feedback = DATABASE_CREATE_DATABASE_MALFORMED_MESSAGE
    return
  }
  applyDatabaseCatalog(result.data)
  selectedNodeId.value = `${result.data.connection.id}:${result.data.catalog.name}`
  closeCreateDatabaseModal()
  showNotice(result.data.message || 'Database created in workspace catalog')
}

async function createDatabaseViaBackend(connectionId: string, sql: string, requestedName: string): Promise<DatabaseCreateDatabaseResult> {
  if (!window.aiops?.createDatabaseCatalog) {
    return { ok: false, errorCode: 'DB_PRELOAD_UNAVAILABLE', errorMessage: 'Database create API is unavailable.' }
  }
  return window.aiops.createDatabaseCatalog({ connectionId, sql, requestedName })
}

function parseCreateDatabaseName(sql: string) {
  const match = sql.match(/\bcreate\s+database\s+(?:if\s+not\s+exists\s+)?(`(?:``|[^`])+`|"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_]*)/i)
  if (!match) return ''
  const token = match[1]
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  return token
}

async function copyDdl() {
  if (!ddlModal.ddl.trim()) {
    showNotice('DDL is empty')
    return
  }
  if (await copyText(ddlModal.ddl)) showNotice('DDL copied')
}

function openDbAiFromToolbar(action: Extract<DbAiAction, 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete'>) {
  const tab = activeSqlTab.value
  if (!tab) return
  const selected = getSelectedSqlText().trim()
  const current = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim()
  const cursorPrefix = getSqlTextUntilCursor().trim()
  const sourceSql = action === 'complete' ? cursorPrefix : selected || current || tab.sql.trim()
  if (action !== 'nl2sql' && action !== 'complete' && !sourceSql) {
    showNotice('SQL is empty')
    return
  }
  const contextParts = buildDbAiContextParts(tab)
  if (action === 'complete') contextParts.push(sourceSql ? 'cursor prefix' : 'default table context')
  else contextParts.push(selected ? 'selection' : current ? 'current statement' : action === 'nl2sql' ? 'natural language prompt' : 'full editor')
  const sql =
    action === 'nl2sql'
      ? 'show the latest open orders with service, owner, status, and updated time'
      : action === 'complete' && !sourceSql
        ? renderDefaultSql(findConnection(tab.connectionId), currentSqlCatalogs.value[0], tab.schemaName)
        : sourceSql
  openDbAi(action, sql, contextParts.join(' · '))
}

function buildDbAiContextParts(tab: Extract<WorkspaceTab, { kind: 'sql' }>) {
  const connection = findConnection(tab.connectionId)
  return [connection?.name, connection?.dbType, tab.catalogName, tab.schemaName].filter(Boolean)
}

function buildDbAiBackendContext(contextSummary = '', override: DbAiBackendContext = {}): DbAiBackendContext {
  const tab = activeSqlTab.value
  const connection = override.connectionId ? findConnection(override.connectionId) : tab ? findConnection(tab.connectionId) : undefined
  return {
    connectionId: override.connectionId ?? tab?.connectionId ?? '',
    dbType: override.dbType ?? connection?.dbType ?? '',
    databaseName: override.databaseName ?? tab?.catalogName ?? '',
    schemaName: override.schemaName !== undefined ? override.schemaName : tab?.schemaName || undefined,
    tableName: override.tableName !== undefined ? override.tableName : tab?.tableName || undefined,
    contextSummary: override.contextSummary ?? contextSummary
  }
}

function dbAiBackendContextForIpc(context: DbAiBackendContext): DatabaseAiDrawerResponseInput['context'] {
  return {
    connectionId: String(context.connectionId || ''),
    dbType: context.dbType || '',
    databaseName: String(context.databaseName || ''),
    schemaName: context.schemaName ? String(context.schemaName) : undefined,
    tableName: context.tableName ? String(context.tableName) : undefined,
    contextSummary: context.contextSummary ? String(context.contextSummary) : undefined
  }
}

async function openDbAi(action: DbAiAction, sql: string, context = '', backendContextOverride: DbAiBackendContext = {}) {
  const backendContext = buildDbAiBackendContext(context, backendContextOverride)
  const activeDialect = backendContext.dbType || (activeSqlTab.value ? findConnection(activeSqlTab.value.connectionId)?.dbType : undefined)
  const normalizedDialect: DbAiTargetDialect =
    activeDialect === 'sqlserver'
      ? 'mssql'
      : activeDialect && isMysqlCompatibleDbType(activeDialect)
        ? 'mysql'
        : activeDialect && isPostgresCompatibleDbType(activeDialect)
          ? 'postgresql'
          : activeDialect || 'postgresql'
  const targetDialect: DbAiTargetDialect = action === 'convert' ? normalizedDialect : normalizedDialect
  const createBridge = window.aiops?.createDatabaseAiDrawerRequest
  if (typeof createBridge !== 'function') {
    showNotice('DB AI drawer request service unavailable')
    return
  }
  let result: DatabaseAiDrawerRequestResult
  try {
    result = await createBridge({
      action,
      sourceSql: sql,
      targetDialect,
      context: dbAiBackendContextForIpc({ ...backendContext, contextSummary: backendContext.contextSummary || context })
    })
  } catch (error) {
    showNotice(bridgeErrorMessage(error, 'DB AI request failed'))
    return
  }
  if (!result.ok) {
    showNotice(result.errorMessage || 'DB AI request failed')
    return
  }
  if (!isDbAiDrawerRequestRecord(result.data)) {
    showNotice('DB AI drawer backend returned malformed request data.')
    return
  }
  const request = result.data
  dbAiRequests.value = { ...dbAiRequests.value, [request.id]: request }
  dbAiActiveReqId.value = request.id
  dbAiOpen.value = true
  void requestDbAiDrawerResponse(request.id)
  closeMenus()
}

function patchDbAiRequest(reqId: string, patch: Partial<DbAiRequest>) {
  const existing = dbAiRequests.value[reqId]
  if (!existing) return
  dbAiRequests.value = {
    ...dbAiRequests.value,
    [reqId]: { ...existing, ...patch }
  }
}

async function requestDbAiDrawerResponse(reqId: string) {
  const request = dbAiRequests.value[reqId]
  if (!request) return
  const expectedDialect = request.targetDialect
  const startBridge = window.aiops?.startDatabaseAiDrawerResponse
  if (typeof startBridge !== 'function') {
    const message = 'DB AI drawer start service unavailable'
    showNotice(message)
    return
  }
  let started: DatabaseAiDrawerLifecycleResult
  try {
    started = await startBridge({ requestId: reqId })
  } catch (error) {
    const message = bridgeErrorMessage(error, 'DB AI drawer request failed to start')
    showNotice(message)
    return
  }
  if (!started.ok) {
    const message = started.errorMessage || 'DB AI drawer request failed to start'
    showNotice(message)
    return
  }
  if (!isDbAiDrawerRequestRecord(started.data, reqId)) {
    const message = 'DB AI drawer backend returned malformed lifecycle data.'
    showNotice(message)
    return
  }
  patchDbAiRequest(reqId, { status: started.data.status, text: started.data.text, updatedAt: started.data.updatedAt })
  const generateBridge = window.aiops?.generateDatabaseAiDrawerResponse
  if (typeof generateBridge !== 'function') {
    const message = 'DB AI drawer response service unavailable'
    showNotice(message)
    return
  }
  try {
    const result = await generateBridge({
      requestId: reqId,
      action: request.action,
      sourceSql: request.sourceSql,
      targetDialect: expectedDialect,
      context: dbAiBackendContextForIpc(request.backendContext)
    })
    finishDbAiRequest(reqId, result, expectedDialect)
  } catch (error) {
    showNotice(bridgeErrorMessage(error, 'DB AI drawer response failed'))
  }
}

function finishDbAiRequest(reqId: string, result: DatabaseAiDrawerResponseResult, expectedDialect?: DbAiTargetDialect) {
  const request = dbAiRequests.value[reqId]
  if (!request || request.status === 'cancelled') return
  if (expectedDialect && request.targetDialect !== expectedDialect) return
  const hasValidResponseData = isDbAiDrawerResponseData(result.data, reqId)
  const responseData = hasValidResponseData ? result.data : null
  if (result.ok && !hasValidResponseData) {
    const message = 'DB AI drawer backend returned malformed response data.'
    showNotice(message)
    return
  }
  if (responseData) {
    dbAiRequests.value = {
      ...dbAiRequests.value,
      [reqId]: responseData.request
    }
    return
  }
  const message = result.errorMessage || 'DB AI drawer backend failed.'
  showNotice(message)
}

function setActiveDbAiRequest(reqId: string) {
  const request = dbAiRequests.value[reqId]
  if (!request) return
  dbAiActiveReqId.value = reqId
  dbAiOpen.value = true
}

async function copyDbAiSql() {
  if (await copyText(dbAiSql.value)) showNotice('Generated SQL copied')
}

function insertDbAiSql() {
  const tab = activeSqlTab.value
  if (!tab) return
  const range = getSqlSelectionRange()
  const before = tab.sql.slice(0, range.start)
  const after = tab.sql.slice(range.end)
  const replacingSelection = range.start !== range.end
  const prefix = !replacingSelection && before && !/\s$/.test(before) ? '\n' : ''
  const suffix = !replacingSelection && after && !/^\s/.test(after) ? '\n' : ''
  const nextSql = `${before}${prefix}${dbAiSql.value}${suffix}${after}`
  setEditorSql(nextSql, range.start + prefix.length + dbAiSql.value.length)
  showNotice(replacingSelection ? 'Editor selection replaced' : 'Generated SQL inserted')
}

function replaceDbAiSqlSelection() {
  const tab = activeSqlTab.value
  if (!tab) return
  const selection = getSqlSelectionRange()
  const range = selection.start !== selection.end ? selection : currentSqlStatementRange(tab.sql, getSqlCursorOffset())
  const nextSql = `${tab.sql.slice(0, range.start)}${dbAiSql.value}${tab.sql.slice(range.end)}`
  setEditorSql(nextSql, range.start, range.start + dbAiSql.value.length)
  showNotice(selection.start !== selection.end ? 'Editor selection replaced' : 'Current statement replaced')
}

function runDbAiReadonly() {
  const tab = activeSqlTab.value
  if (!tab || !dbAiCanRunReadOnly.value) return
  void appendSqlExecution(tab, dbAiSql.value)
  showNotice('Read-only SQL executed')
}

function clearSqlDiagnoseTimers() {
  if (sqlDiagnoseSuccessTimer) {
    window.clearTimeout(sqlDiagnoseSuccessTimer)
    sqlDiagnoseSuccessTimer = null
  }
}

async function diagnoseSqlError(result: SqlResult) {
  const tab = activeSqlTab.value
  if (!tab || result.status !== 'error') return
  if (!activeSqlCanRun.value) {
    sqlDiagnose.running = false
    sqlDiagnose.success = false
    sqlDiagnose.resultId = result.id
    sqlDiagnose.error = 'Database context is required before diagnosis.'
    return
  }
  clearSqlDiagnoseTimers()
  sqlDiagnose.running = true
  sqlDiagnose.success = false
  sqlDiagnose.error = ''
  sqlDiagnose.resultId = result.id

  try {
    const connection = findConnection(tab.connectionId)
    const diagnoseBridge = window.aiops?.diagnoseDatabaseSqlError
    if (typeof diagnoseBridge !== 'function') {
      sqlDiagnose.running = false
      sqlDiagnose.success = false
      sqlDiagnose.error = 'DB AI diagnosis service unavailable'
      return
    }
    const response = await diagnoseBridge({
      sourceSql: result.sql,
      targetDialect: connection?.dbType ?? 'postgresql',
      context: dbAiBackendContextForIpc(
        buildDbAiBackendContext('', {
          connectionId: tab.connectionId,
          dbType: connection?.dbType ?? '',
          databaseName: tab.catalogName,
          schemaName: tab.schemaName || undefined,
          tableName: tab.tableName || undefined,
          contextSummary: buildDbAiContextParts(tab).join(' · ')
        })
      ),
      errorMessage: result.error ?? ''
    })
    if (sqlDiagnose.resultId !== result.id) return
    if (!response.ok) {
      sqlDiagnose.running = false
      sqlDiagnose.success = false
      sqlDiagnose.error = response.errorMessage || 'DB AI diagnosis failed.'
      return
    }
    if (!isDbAiDrawerResponseData(response.data, response.data?.request?.id ?? '') || !response.data.sql.trim()) {
      sqlDiagnose.running = false
      sqlDiagnose.success = false
      sqlDiagnose.error = 'DB AI diagnosis backend returned malformed result data.'
      return
    }
    const diagnosedSql = response.data.sql
    setEditorSql(diagnosedSql, diagnosedSql.length)
    sqlDiagnose.running = false
    sqlDiagnose.success = true
    sqlDiagnose.error = ''
    showNotice('SQL diagnosis applied to editor')
    sqlDiagnoseSuccessTimer = window.setTimeout(() => {
      if (sqlDiagnose.resultId === result.id) sqlDiagnose.success = false
      sqlDiagnoseSuccessTimer = null
    }, 3000)
  } catch (error) {
    if (sqlDiagnose.resultId !== result.id) return
    sqlDiagnose.running = false
    sqlDiagnose.success = false
    sqlDiagnose.error = bridgeErrorMessage(error, 'DB AI diagnosis failed.')
  }
}

async function cancelDbAiRequest() {
  const request = activeDbAiRequest.value
  if (!request) return
  if (request.status === 'done' || request.status === 'error') return
  const cancelBridge = window.aiops?.cancelDatabaseAiDrawerResponse
  if (typeof cancelBridge !== 'function') {
    showNotice('DB AI drawer cancel service unavailable')
    return
  }
  let result: DatabaseAiDrawerLifecycleResult
  try {
    result = await cancelBridge({ requestId: request.id })
  } catch (error) {
    showNotice(bridgeErrorMessage(error, 'DB AI request cancel failed'))
    return
  }
  if (!result.ok) {
    showNotice(result.errorMessage || 'DB AI request cancel failed')
    return
  }
  if (!isDbAiDrawerRequestRecord(result.data, request.id)) {
    showNotice('DB AI drawer backend returned malformed lifecycle data.')
    return
  }
  dbAiRequests.value = {
    ...dbAiRequests.value,
    [request.id]: result.data
  }
  showNotice('DB AI request cancelled')
}

function clearDbAiRequest() {
  const request = activeDbAiRequest.value
  if (request) {
    const { [request.id]: _removed, ...rest } = dbAiRequests.value
    dbAiRequests.value = rest
    const fallback = Object.values(rest).sort((a, b) => b.createdAt - a.createdAt)[0]
    dbAiActiveReqId.value = fallback?.id ?? null
  }
  dbAiOpen.value = Boolean(dbAiActiveReqId.value)
}

function formatDbAiRequestTime(time: number) {
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function isDbAiExecutableDialect(action: DbAiAction, target: DbAiTargetDialect) {
  if (action !== 'convert') return true
  const tab = activeSqlTab.value
  const connection = tab ? findConnection(tab.connectionId) : undefined
  if (target === 'mssql') return connection?.dbType === 'sqlserver'
  if (target === 'mysql') return !!connection && isMysqlCompatibleDbType(connection.dbType)
  if (target === 'postgresql') return !!connection && isPostgresCompatibleDbType(connection.dbType)
  return connection?.dbType === target
}

function dbAiDialectLabel(dialect: DbAiTargetDialect) {
  return dbAiDialectOptions.find((option) => option.value === dialect)?.label ?? dialect
}

function isReadOnlySql(sql: string) {
  const cleaned = stripLeadingSqlComments(sql).trim()
  if (!/^(select|with|explain)\b/i.test(cleaned)) return false
  return !/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|call|execute)\b/i.test(cleaned)
}

function stripLeadingSqlComments(sql: string) {
  let next = sql.trim()
  let changed = true
  while (changed) {
    changed = false
    const before = next
    next = next.replace(/^--[^\n]*(?:\n|$)/, '').replace(/^\/\*[\s\S]*?\*\//, '').trimStart()
    changed = next !== before
  }
  return next
}

function getSqlTextUntilCursor() {
  const tab = activeSqlTab.value
  if (!tab) return ''
  return tab.sql.slice(0, getSqlCursorOffset())
}

function setEditorSql(nextSql: string, selectionStart: number, selectionEnd = selectionStart) {
  const tab = activeSqlTab.value
  if (!tab) return
  tab.sql = nextSql
  void nextTick(() => {
    const editor = sqlEditorRef.value
    if (!editor) return
    const start = Math.max(0, Math.min(selectionStart, nextSql.length))
    const end = Math.max(0, Math.min(selectionEnd, nextSql.length))
    editor.focus()
    editor.setSelectionRange(start, end)
    syncSqlEditorState()
  })
}

function extractSql(text: string) {
  const match = text.match(/```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|tsql|clickhouse|presto)?\s*\n([\s\S]*?)```/i)
  return match?.[1].trim() ?? text
}

function engineAccent(code: DatabaseEngineCode) {
  return databaseEngines.value.find((engine) => engine.connectionCode === code)?.accent ?? '#8a94a6'
}

function engineName(code: DatabaseEngineCode) {
  return databaseEngines.value.find((engine) => engine.connectionCode === code)?.name ?? code
}

function quoteIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9_]/g, '_')
}

function quoteIdentForDialect(value: string, dbType: DatabaseEngineCode) {
  if (isMysqlCompatibleDbType(dbType) || dbType === 'clickhouse') return `\`${String(value).replace(/`/g, '``')}\``
  if (dbType === 'sqlserver') return `[${String(value).replace(/]/g, ']]')}]`
  return `"${String(value).replace(/"/g, '""')}"`
}

function closeMenus() {
  addMenuOpen.value = false
  contextMenu.value = null
  contextSubmenu.value = null
  overflowOpen.value = false
}

function closeContextSubmenuSoon() {
  contextSubmenu.value = null
}

function showNotice(text: string) {
  notice.value = text
  if (noticeTimer.value) window.clearTimeout(noticeTimer.value)
  noticeTimer.value = window.setTimeout(() => {
    notice.value = ''
    noticeTimer.value = null
  }, 1800)
}

async function copyText(value: string) {
  const text = String(value ?? '')
  const copied = await copyTextToClipboard(text)
  if (!copied) showNotice('Copy failed')
  return copied
}

function handleWindowClick() {
  closeMenus()
}

onMounted(() => {
  void loadDatabaseCatalog().finally(() => loadDbAiPaneState())
  window.addEventListener('click', handleWindowClick)
})

onBeforeUnmount(() => {
  stopSqlPaneResize()
  stopDbAiPaneResize()
  clearSqlDiagnoseTimers()
  window.removeEventListener('click', handleWindowClick)
  if (noticeTimer.value) window.clearTimeout(noticeTimer.value)
  persistDbAiPaneState()
})

watch(editingGroupId, async (id) => {
  if (!id) return
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('.db-tree-edit')
  input?.focus()
  input?.select()
})

watch(
  () => [activeSqlTab.value?.id ?? '', activeSqlTab.value?.sql ?? ''] as const,
  async () => {
    await nextTick()
    syncSqlEditorState()
  },
  { immediate: true }
)

watch([sqlFindQuery, sqlFindCaseSensitive, () => activeSqlTab.value?.id ?? ''], () => {
  const matches = sqlFindMatches.value
  if (!sqlFindOpen.value || !matches.length) {
    sqlFindActiveIndex.value = -1
    return
  }
  alignSqlFindIndexToSelection()
})

watch(
  [
    dbAiPaneOpen,
    dbAiPaneWidth,
    dbAiPaneDraft,
    dbAiPaneMessages,
    () => [dbAiPaneContext.connectionId, dbAiPaneContext.catalogName, dbAiPaneContext.schemaName, dbAiPaneContext.dbType].join('|')
  ],
  persistDbAiPaneState,
  { deep: true }
)
</script>
