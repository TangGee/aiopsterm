<template>
  <section class="database-workspace">
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
            v-model="keyword"
            placeholder="Search"
          />
        </div>

        <nav class="db-tree">
          <ul>
            <li
              v-for="group in visibleGroups"
              :key="group.id"
            >
              <div
                class="db-tree-row group"
                :class="{ selected: selectedNodeId === group.id }"
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
                              <li>
                                <div class="db-tree-row folder">
                                  <span class="db-tree-spacer" />
                                  <FolderOpen />
                                  <span>tables</span>
                                </div>
                                <ul class="db-tree-children deep">
                                  <li
                                    v-for="table in schema.tables"
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
        <button
          v-for="tab in tabs"
          :key="tab.id"
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
        <div class="db-tab-overflow">
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
          <div>
            <span>Overview</span>
            <h2>Overview</h2>
            <p>Manage connections, browse schema trees, open table data, and run SQL consoles from the Database workspace.</p>
          </div>
          <div class="db-overview-tips">
            <span><strong>+</strong> Create connection</span>
            <span><strong>/</strong> Explore schemas</span>
            <span><strong>SQL</strong> Query console</span>
          </div>
        </div>
        <div class="db-overview-panel">
          <header>
            <div>
              <strong>New Connection</strong>
              <p>Choose a database engine to start a connection profile.</p>
            </div>
            <em>{{ mockDatabaseEngines.length }}</em>
          </header>
          <div class="db-engine-grid">
            <button
              v-for="engine in mockDatabaseEngines"
              :key="`${engine.name}-${engine.code}`"
              type="button"
              :class="{ disabled: !engine.enabled }"
              @click="engine.enabled && openConnectionModal(engine.code)"
            >
              <span
                class="db-engine-dot"
                :style="{ background: engine.accent }"
              />
              <span>{{ engine.name }}</span>
              <small v-if="!engine.enabled">Coming Soon</small>
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
            title="Run all"
            :disabled="!activeSqlCanRun"
            @click="runSql('all')"
          >
            <Play />
          </button>
          <button
            type="button"
            title="Run current statement"
            :disabled="!activeSqlCanRun"
            @click="runSql('current')"
          >
            <CornerDownRight />
          </button>
          <button
            type="button"
            title="Explain"
            :disabled="!activeSqlCanRun"
            @click="runSql('explain')"
          >
            <Lightbulb />
          </button>
          <span class="db-toolbar-divider" />
          <button
            type="button"
            disabled
            title="Save"
          >
            <Save />
          </button>
          <button
            type="button"
            disabled
            title="Save As"
          >
            <SaveAll />
          </button>
          <button
            type="button"
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
          <select v-model="activeTab.connectionId">
            <option value="">Connection</option>
            <option
              v-for="connection in connections"
              :key="connection.id"
              :value="connection.id"
            >
              {{ connection.name }}
            </option>
          </select>
          <select v-model="activeTab.catalogName">
            <option value="">Database</option>
            <option
              v-for="catalog in currentSqlCatalogs"
              :key="catalog.name"
              :value="catalog.name"
            >
              {{ catalog.name }}
            </option>
          </select>
          <select
            v-if="currentSqlSchemas.length"
            v-model="activeTab.schemaName"
          >
            <option value="">Schema</option>
            <option
              v-for="schema in currentSqlSchemas"
              :key="schema.name"
              :value="schema.name"
            >
              {{ schema.name }}
            </option>
          </select>
        </div>
        <div class="db-sql-panes">
          <textarea
            ref="sqlEditorRef"
            v-model="activeTab.sql"
            class="db-sql-editor"
            spellcheck="false"
            @keydown.meta.enter.prevent="runSqlFromShortcut"
            @keydown.ctrl.enter.prevent="runSqlFromShortcut"
          />
          <div class="db-sql-results">
            <div class="db-result-tabs">
              <button
                type="button"
                :class="{ active: activeTab.activeResultTabId === 'overview' }"
                @click="activeTab.activeResultTabId = 'overview'"
              >
                Overview
              </button>
              <button
                v-for="result in activeTab.resultTabs"
                :key="result.id"
                type="button"
                :class="{ active: activeTab.activeResultTabId === result.id }"
                @click="activeTab.activeResultTabId = result.id"
              >
                <span
                  class="db-result-dot"
                  :class="result.status"
                />
                {{ result.title }}
                <X @click.stop="closeResultTab(result.id)" />
              </button>
            </div>

            <div
              v-if="activeTab.activeResultTabId === 'overview'"
              class="db-sql-overview"
            >
              <header>
                <h3>Execution History</h3>
                <span>{{ sqlOverviewSummary }}</span>
              </header>
              <p v-if="!activeTab.history.length">Run SQL to create a result tab.</p>
              <table v-else>
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>SQL</th>
                    <th>Message</th>
                    <th>Rows</th>
                    <th>Duration</th>
                    <th>Time</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="history in activeTab.history"
                    :key="history.id"
                    :class="{ closed: isSqlHistoryClosed(history), error: history.status === 'error' }"
                    @click="openSqlHistoryResult(history)"
                  >
                    <td>
                      <span
                        class="db-sql-overview-index"
                        :class="history.status"
                      >
                        {{ history.title }}
                      </span>
                    </td>
                    <td>
                      <span
                        class="db-result-dot"
                        :class="history.status"
                      />
                      <code>{{ history.sql }}</code>
                    </td>
                    <td>
                      <strong :class="history.status">{{ history.message }}</strong>
                      <small v-if="!history.resultTabId">Result tab closed</small>
                    </td>
                    <td>{{ history.rowCount }}</td>
                    <td>{{ history.durationMs }}ms</td>
                    <td>{{ history.createdAt }}</td>
                    <td>
                      <button
                        type="button"
                        class="db-sql-overview-open"
                        :disabled="isSqlHistoryClosed(history)"
                        @click.stop="openSqlHistoryResult(history)"
                      >
                        Open
                      </button>
                    </td>
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
                  <p>{{ activeSqlResult.sql }}</p>
                </div>
              </div>
              <div
                v-else-if="activeSqlResult.status === 'error'"
                class="db-result-error"
              >
                <span>{{ activeSqlResult.error }}</span>
                <button
                  type="button"
                  @click="openDbAi('diagnose', activeSqlResult.sql, 'active SQL result')"
                >
                  Diagnose
                </button>
              </div>
              <template v-else>
                <DataGridToolbar
                  :page="activeSqlResult.page"
                  :page-size="activeSqlResult.pageSize"
                  :total="filteredSqlRows.length"
                  :hide-refresh="true"
                  @goto-page="(page) => updateSqlResultPage(page)"
                  @goto-last-page="gotoLastSqlResultPage"
                  @change-page-size="(size) => updateSqlResultPageSize(size)"
                />
                <ResultGrid
                  :columns="activeSqlResult.columns"
                  :rows="pagedSqlRows"
                  :source-rows="activeSqlResult.rows"
                  :sort="activeSqlResult.sort"
                  :filters="activeSqlResult.filters"
                  :start-row-index="(activeSqlResult.page - 1) * activeSqlResult.pageSize + 1"
                  @sort="(column) => cycleSqlSort(column)"
                  @filter="(column, filter) => applySqlFilter(column, filter)"
                />
                <DataStatusBar
                  :error="activeSqlResult.error || undefined"
                  :duration-ms="activeSqlResult.durationMs"
                  :row-count="filteredSqlRows.length"
                />
              </template>
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
          :total="filteredDataRows.length"
          :can-edit="true"
          :has-selection="!!activeDataTab.selectedRowKey"
          :can-undo="activeDataTab.undoStack.length > 0"
          :is-dirty="isDataTabDirty(activeDataTab)"
          @goto-page="(page) => updateDataPage(page)"
          @goto-last-page="gotoLastDataPage"
          @change-page-size="(size) => updateDataPageSize(size)"
          @refresh="refreshDataTab"
          @add-row="addDataRow"
          @delete-row="deleteSelectedDataRow"
          @undo="undoDataChanges"
          @save="saveDataChanges"
        />
        <div class="db-where-bar">
          <span><Table2 /> {{ activeDataTab.tableName }}</span>
          <i />
          <input
            v-model="activeDataTab.whereRaw"
            placeholder="Input WHERE condition"
            @keydown.enter.prevent="applyWhere"
          />
          <button
            type="button"
            title="Apply filter"
            @click="applyWhere"
          >
            <Play />
          </button>
        </div>
        <section
          v-if="activeDataEditSummary?.isDirty"
          class="db-edit-summary"
        >
          <div class="db-edit-summary-counts">
            <span><strong>{{ activeDataEditSummary.newRows }}</strong> New</span>
            <span><strong>{{ activeDataEditSummary.updatedRows }}</strong> Updated</span>
            <span><strong>{{ activeDataEditSummary.deletedRows }}</strong> Deleted</span>
            <span><strong>{{ activeDataEditSummary.undoDepth }}</strong> Undo</span>
          </div>
          <pre>{{ activeDataEditSummary.preview || 'No SQL statement will be generated until a new row contains at least one value.' }}</pre>
          <div class="db-edit-summary-actions">
            <button
              type="button"
              :disabled="!activeDataEditSummary.preview"
              @click="copyDataMutationPreview"
            >
              Copy Preview
            </button>
            <button
              type="button"
              @click="discardDataChanges"
            >
              Discard All
            </button>
          </div>
        </section>
        <ResultGrid
          :columns="activeDataTab.columns"
          :rows="pagedDataRows"
          :source-rows="activeDataTab.rows"
          :sort="activeDataTab.sort"
          :filters="activeDataTab.filters"
          :start-row-index="(activeDataTab.page - 1) * activeDataTab.pageSize + 1"
          :selected-key="activeDataTab.selectedRowKey || undefined"
          :primary-key="activeDataTab.primaryKey"
          :new-rows="activeDataTab.dirtyState.newRows"
          :deleted-row-keys="activeDataTab.dirtyState.deletedRowKeys"
          :updated-cells="activeDataTab.dirtyState.updatedCells"
          :editable="true"
          @sort="(column) => cycleDataSort(column)"
          @filter="(column, filter) => applyDataFilter(column, filter)"
          @select-row="setActiveDataSelectedRow"
          @cell-edit="updateDataCell"
          @new-row-cell-edit="updateNewDataRowCell"
        />
        <DataStatusBar
          :duration-ms="activeDataTab.durationMs"
          :row-count="filteredDataRows.length"
        />
      </section>
    </main>

    <aside
      v-if="dbAiOpen"
      class="db-ai-drawer"
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
        @click="addGroup"
      >
        New Group
      </button>
      <div class="db-popup-subtitle">New Connection</div>
      <button
        v-for="engine in mockDatabaseEngines.filter((item) => item.enabled)"
        :key="engine.name"
        type="button"
        @click="openConnectionModal(engine.code)"
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
        <button
          type="button"
          @click="startGroupRename(contextMenu.groupId)"
        >
          Rename
        </button>
        <button
          type="button"
          @click="copyContextName"
        >
          Copy Name
        </button>
        <button
          type="button"
          @click="deleteGroup(contextMenu.groupId)"
        >
          Delete Group
        </button>
      </template>
      <template v-else-if="contextMenu.type === 'connection'">
        <button
          type="button"
          @click="connectFromMenu(contextMenu.connectionId)"
        >
          Open/Close Connection
        </button>
        <button
          type="button"
          @click="openSqlConsole(contextMenu.connectionId)"
        >
          Query Console
        </button>
        <button
          type="button"
          @click="openCreateDatabaseModal(contextMenu.connectionId)"
        >
          Create Database
        </button>
        <button
          type="button"
          @click="editConnection(contextMenu.connectionId)"
        >
          Editor Source
        </button>
        <button
          type="button"
          @click="copyContextName"
        >
          Copy Name
        </button>
        <button
          type="button"
          @click="removeConnection(contextMenu.connectionId)"
        >
          Remove
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          @click="openContextTable"
        >
          Open Table
        </button>
        <button
          type="button"
          @click="openContextSql"
        >
          Query Console
        </button>
        <button
          type="button"
          @click="copyContextName"
        >
          Copy Name
        </button>
        <button
          type="button"
          @click="openDdlModalFromContext"
        >
          View DDL
        </button>
        <button
          type="button"
          @click="copySelectSql"
        >
          Copy SELECT
        </button>
        <button
          type="button"
          @click="requestDangerousTableAction('truncate')"
        >
          Truncate
        </button>
        <button
          class="danger"
          type="button"
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
          <label v-if="connectionDraft.dbType === 'postgresql'">
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
            @click="testConnectionDraft"
          >
            Test Connection
          </button>
          <span />
          <button
            type="button"
            @click="closeConnectionModal"
          >
            Cancel
          </button>
          <button type="submit">Save</button>
        </footer>
      </form>
    </div>

    <div
      v-if="createDatabaseModal.open"
      class="db-modal-overlay"
      @click.self="createDatabaseModal.open = false"
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
            @click="createDatabaseModal.open = false"
          >
            <X />
          </button>
        </header>
        <label>
          Name:
          <input
            v-model="createDatabaseModal.name"
            required
          />
        </label>
        <strong>Preview</strong>
        <textarea
          v-model="createDatabaseSql"
          spellcheck="false"
        />
        <footer>
          <button
            type="button"
            @click="createDatabaseModal.open = false"
          >
            Cancel
          </button>
          <button type="submit">Create</button>
        </footer>
      </form>
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
            @click="copyDdl"
          >
            Copy
          </button>
        </div>
        <textarea
          :value="ddlModal.ddl"
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
      v-if="notice"
      class="db-toast"
    >
      {{ notice }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type PropType } from 'vue'
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
import {
  mockDatabaseConnections,
  mockDatabaseEngines,
  mockDatabaseGroups,
  type MockDatabaseCatalog,
  type MockDatabaseColumn,
  type MockDatabaseConnection,
  type MockDatabaseEngineCode,
  type MockDatabaseGroup,
  type MockDatabaseTable
} from '@/data/mockData'

type DbFilter =
  | { column: string; operator: 'like' | 'eq' | 'neq'; value: string }
  | { column: string; operator: 'in'; values: string[] }
  | { column: string; operator: 'isnull' | 'notnull' }
type DbSort = { column: string; direction: 'asc' | 'desc' } | null
type ResultStatus = 'running' | 'ok' | 'error'
type DbFilterValueEntry = { value: string; label: string; count: number }
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
  preview: string
}
type DbAiAction = 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete' | 'diagnose' | 'drop' | 'truncate'
type DbAiTargetDialect = MockDatabaseEngineCode | 'mssql'
type TextRange = { start: number; end: number }

const DB_FILTER_NULL = '__AIOPSTERM_DB_NULL__'
const DB_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

type SqlResult = {
  id: string
  title: string
  sql: string
  status: ResultStatus
  columns: string[]
  rows: Array<Record<string, unknown>>
  durationMs: number
  error: string | null
  page: number
  pageSize: number
  filters: DbFilter[]
  sort: DbSort
}

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
      sql: string
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
      rows: Array<Record<string, unknown>>
      primaryKey: string[]
      whereRaw: string
      page: number
      pageSize: number
      filters: DbFilter[]
      sort: DbSort
      selectedRowKey: string | null
      durationMs: number
      dirtyState: DirtyState
      undoStack: EditOp[]
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

const DataGridToolbar = defineComponent({
  props: {
    page: { type: Number, required: true },
    pageSize: { type: Number, required: true },
    total: { type: Number, required: true },
    canEdit: { type: Boolean, default: false },
    hasSelection: { type: Boolean, default: false },
    canUndo: { type: Boolean, default: false },
    isDirty: { type: Boolean, default: false },
    hideRefresh: { type: Boolean, default: false }
  },
  emits: ['gotoPage', 'gotoLastPage', 'changePageSize', 'refreshTotal', 'refresh', 'add-row', 'delete-row', 'undo', 'save'],
  setup(props, { emit }) {
    const pageSizes = [10, 50, 100, 500, 1000, 5000, 10000]
    const pageCount = computed(() => Math.max(1, Math.ceil(Math.max(0, props.total) / Math.max(1, props.pageSize))))
    const atFirstPage = computed(() => props.page <= 1)
    const atLastPage = computed(() => props.page >= pageCount.value)
    const gotoPage = (page: number) => emit('gotoPage', Number.isFinite(page) && page > 0 ? Math.floor(page) : 1)
    const changePageSize = (size: number) => emit('changePageSize', Number.isFinite(size) && size > 0 ? Math.floor(size) : 100)
    return () =>
      h('div', { class: 'db-toolbar' }, [
        h('div', { class: 'db-toolbar-group' }, [
          h('button', { type: 'button', disabled: atFirstPage.value, title: 'First page', onClick: () => gotoPage(1) }, '⏮'),
          h('button', { type: 'button', disabled: atFirstPage.value, title: 'Previous page', onClick: () => gotoPage(props.page - 1) }, '⏴'),
          h('input', {
            value: props.page,
            type: 'number',
            min: '1',
            max: String(pageCount.value),
            title: `Page ${props.page} of ${pageCount.value}`,
            onInput: (event: Event) => gotoPage(Number((event.target as HTMLInputElement).value) || 1)
          }),
          h('span', { class: 'db-toolbar-page-count' }, `/ ${pageCount.value}`),
          h('button', { type: 'button', disabled: atLastPage.value, title: 'Next page', onClick: () => gotoPage(props.page + 1) }, '⏵'),
          h(
            'button',
            { type: 'button', disabled: atLastPage.value, title: 'Last page', onClick: () => emit('gotoLastPage') },
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
            'button',
            {
              type: 'button',
              class: 'db-toolbar-total',
              title: props.hideRefresh ? 'Total rows in current result' : 'Refresh total',
              disabled: props.hideRefresh,
              onClick: () => emit('refreshTotal')
            },
            `Total: ${props.total}`
          )
        ]),
        h('div', { class: 'db-toolbar-group' }, [
          !props.hideRefresh && h('button', { type: 'button', title: 'Refresh', onClick: () => emit('refresh') }, '↻'),
          h('button', { type: 'button', disabled: !props.canEdit, title: 'Add row', onClick: () => emit('add-row') }, '+'),
          h('button', { type: 'button', disabled: !props.canEdit || !props.hasSelection, title: 'Delete row', onClick: () => emit('delete-row') }, '-'),
          h('button', { type: 'button', disabled: !props.canUndo, title: 'Undo', onClick: () => emit('undo') }, '↶'),
          h('button', { type: 'button', disabled: !props.canEdit || !props.isDirty, title: 'Save changes', onClick: () => emit('save') }, '💾'),
          h('button', { type: 'button', disabled: true, title: 'Chart' }, '📊'),
          h('button', { type: 'button', disabled: true, title: 'Comment' }, '💬')
        ]),
        h('span', { class: 'db-toolbar-spacer' }),
        h('button', { type: 'button', disabled: true, class: 'db-toolbar-export' }, 'Export ▾')
      ])
  }
})

const DataStatusBar = defineComponent({
  props: {
    error: { type: String, default: '' },
    durationMs: { type: Number, default: 0 },
    rowCount: { type: Number, default: 0 }
  },
  setup(props) {
    return () =>
      h('div', { class: ['db-status-bar', { error: !!props.error }] }, [
        props.error
          ? h('span', [h('b', '【Result】'), props.error])
          : [
              h('span', [h('b', '【Result】'), 'Execution OK']),
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
    const editing = ref<{ origin: 'row' | 'new'; rowKey: string; column: string; value: string } | null>(null)
    const openFilterColumn = ref<string | null>(null)
    const filterSearch = ref('')
    const filterSelection = ref<Set<string>>(new Set())
    const filterMode = ref<'values' | 'eq' | 'neq' | 'like' | 'isnull' | 'notnull'>('values')
    const filterText = ref('')
    const rowKey = (row: Record<string, unknown>, index: number) => {
      if (props.primaryKey.length) return JSON.stringify(props.primaryKey.map((key) => row[key]))
      return `row-${props.startRowIndex + index}`
    }
    const displayCellValue = (row: Record<string, unknown>, key: string, column: string) => {
      const patch = props.updatedCells.get(key)
      if (patch && Object.prototype.hasOwnProperty.call(patch, column)) return patch[column]
      return row[column]
    }
    const renderCellValue = (value: unknown) => (value === null || value === undefined ? h('span', { class: 'db-null' }, '<null>') : String(value))
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
    const seedFilterSelection = (column: string) => {
      const filter = activeFilter(column)
      const next = new Set<string>()
      if (filter?.operator === 'in') filter.values.forEach((value) => next.add(value))
      if ((filter?.operator === 'eq' || filter?.operator === 'like' || filter?.operator === 'neq') && filter.value !== undefined) next.add(filter.value)
      if (filter?.operator === 'isnull') next.add(DB_FILTER_NULL)
      filterSelection.value = next
      filterMode.value = filter?.operator === 'eq' || filter?.operator === 'neq' || filter?.operator === 'like' || filter?.operator === 'isnull' || filter?.operator === 'notnull' ? filter.operator : 'values'
      filterText.value = filter?.operator === 'eq' || filter?.operator === 'neq' || filter?.operator === 'like' ? filter.value : ''
    }
    const openFilter = (column: string, event: MouseEvent) => {
      event.stopPropagation()
      openFilterColumn.value = column
      filterSearch.value = ''
      seedFilterSelection(column)
    }
    const closeFilter = () => {
      openFilterColumn.value = null
      filterSearch.value = ''
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
      if (filterMode.value === 'isnull' || filterMode.value === 'notnull') {
        emit('filter', column, { column, operator: filterMode.value })
        closeFilter()
        return
      }
      if (filterMode.value === 'eq' || filterMode.value === 'neq' || filterMode.value === 'like') {
        const value = filterText.value.trim()
        emit('filter', column, value ? { column, operator: filterMode.value, value } : null)
        closeFilter()
        return
      }
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
      editing.value = { origin, rowKey, column, value: value === null || value === undefined ? '' : String(value) }
    }
    const commit = () => {
      if (!editing.value) return
      if (editing.value.origin === 'new') emit('new-row-cell-edit', editing.value.rowKey, editing.value.column, editing.value.value)
      else emit('cell-edit', editing.value.rowKey, editing.value.column, editing.value.value)
      editing.value = null
    }
    return () =>
      h('div', { class: 'db-result', onClick: closeFilter }, [
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
          h('div', { class: 'db-filter-popover', onClick: (event: MouseEvent) => event.stopPropagation() }, [
	            h('div', { class: 'db-filter-search' }, [
              h('span', '⌕'),
              h('input', {
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
            h('div', { class: 'db-filter-mode-row' }, [
              h(
                'select',
                {
                  value: filterMode.value,
                  onChange: (event: Event) => {
                    filterMode.value = (event.target as HTMLSelectElement).value as typeof filterMode.value
                  }
                },
                [
                  h('option', { value: 'values' }, 'Values'),
                  h('option', { value: 'eq' }, '='),
                  h('option', { value: 'neq' }, '!='),
                  h('option', { value: 'like' }, 'LIKE'),
                  h('option', { value: 'isnull' }, 'IS NULL'),
                  h('option', { value: 'notnull' }, 'IS NOT NULL')
                ]
              ),
              (filterMode.value === 'eq' || filterMode.value === 'neq' || filterMode.value === 'like') &&
                h('input', {
                  value: filterText.value,
                  placeholder: `Value for ${openFilterColumn.value}`,
                  onInput: (event: Event) => {
                    filterText.value = (event.target as HTMLInputElement).value
                  },
                  onKeydown: (event: KeyboardEvent) => {
                    if (event.key === 'Enter') applyFilter()
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
              { class: 'db-filter-list' },
              visibleFilterValues.value.length
                ? visibleFilterValues.value.map((entry) =>
                    h('label', { class: 'db-filter-row' }, [
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

const groups = ref<MockDatabaseGroup[]>(mockDatabaseGroups.map((group) => ({ ...group })))
const connections = ref<MockDatabaseConnection[]>(structuredClone(mockDatabaseConnections))
const keyword = ref('')
const sidebarCollapsed = ref(false)
const expandedGroups = ref<string[]>(['group-default', 'group-prod', 'group-local'])
const expandedConnections = ref<string[]>(['conn-prod-pg'])
const expandedCatalogs = ref<string[]>(['conn-prod-pg:orders'])
const expandedSchemas = ref<string[]>(['conn-prod-pg:orders:public', 'conn-prod-pg:orders:ops'])
const expandedTables = ref<string[]>([])
const selectedNodeId = ref<string | null>('conn-prod-pg')
const overflowOpen = ref(false)
const addMenuOpen = ref(false)
const addButtonRef = ref<HTMLButtonElement | null>(null)
const addMenuPosition = ref({ x: 0, y: 0 })
const contextMenu = ref<ContextMenu | null>(null)
const notice = ref('')
const noticeTimer = ref<number | null>(null)
const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')

const tabs = ref<WorkspaceTab[]>([
  { id: 'tab-overview', kind: 'overview', title: 'Overview' },
  {
    id: 'tab-sql-1',
    kind: 'sql',
    title: 'SQL Console',
    connectionId: 'conn-prod-pg',
    catalogName: 'orders',
    schemaName: 'public',
    sql: 'select id, service, status, owner, updated_at\nfrom public.orders\nwhere status <> \'closed\'\norder by updated_at desc\nlimit 20;',
    resultTabs: [],
    activeResultTabId: 'overview',
    history: []
  }
])
const activeTabId = ref('tab-overview')
const resultSeq = ref(1)
const sqlEditorRef = ref<HTMLTextAreaElement | null>(null)

const connectionModalOpen = ref(false)
const connectionModalMode = ref<'create' | 'edit'>('create')
const connectionFeedback = ref('')
const connectionFeedbackKind = ref<'info' | 'error'>('info')
const connectionErrors = ref<string[]>([])
const connectionUrlDirty = ref(false)
const passwordVisible = ref(false)
const postgresSslModeOptions = ['disable', 'require', 'verify-ca', 'verify-full'] as const
const connectionDraft = reactive({
  id: '',
  dbType: 'mysql' as MockDatabaseEngineCode,
  name: '',
  env: 'Development' as MockDatabaseConnection['env'],
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 3306 as number | null,
  authentication: 'UserAndPassword' as MockDatabaseConnection['authentication'],
  user: 'root',
  password: '',
  database: '',
  filePath: '/tmp/aiopsterm/demo.db',
  readonly: false,
  sslMode: '' as NonNullable<MockDatabaseConnection['sslMode']>,
  url: ''
})

const createDatabaseModal = reactive({ open: false, connectionId: '', name: '', sql: '' })
const ddlModal = reactive({ open: false, tableName: '', ddl: '' })
const dbAiOpen = ref(false)
const dbAiActionLabel = ref('Explain')
const dbAiAction = ref<DbAiAction>('explain')
const dbAiSourceSql = ref('')
const dbAiText = ref('')
const dbAiStatus = ref<'idle' | 'streaming' | 'done' | 'cancelled'>('idle')
const dbAiContextSummary = ref('')
const dbAiTimer = ref<number | null>(null)
const dbAiTargetDialect = ref<DbAiTargetDialect>('postgresql')
const dbAiDialectOptions: Array<{ value: DbAiTargetDialect; label: string }> = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'mssql', label: 'SQL Server' }
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

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value))
const activeSqlTab = computed(() => (activeTab.value?.kind === 'sql' ? activeTab.value : null))
const activeDataTab = computed(() => (activeTab.value?.kind === 'data' ? activeTab.value : null))
const activeDataEditSummary = computed(() => (activeDataTab.value ? buildDataEditSummary(activeDataTab.value) : null))

const activeSqlCanRun = computed(() => {
  const tab = activeSqlTab.value
  if (!tab) return false
  const connection = findConnection(tab.connectionId)
  if (!connection || !tab.catalogName) return false
  if (connection.dbType === 'postgresql' || connection.dbType === 'oracle') return !!tab.schemaName
  return true
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

const activeSqlResult = computed(() => {
  const tab = activeSqlTab.value
  if (!tab || tab.activeResultTabId === 'overview') return null
  return tab.resultTabs.find((result) => result.id === tab.activeResultTabId) ?? null
})

const activeSqlHasText = computed(() => Boolean(activeSqlTab.value?.sql.trim()))
const sqlOverviewSummary = computed(() => {
  const tab = activeSqlTab.value
  if (!tab) return '0 executions'
  const closed = tab.history.filter((history) => isSqlHistoryClosed(history)).length
  const failed = tab.history.filter((history) => history.status === 'error').length
  const suffix = [failed ? `${failed} failed` : '', closed ? `${closed} closed` : ''].filter(Boolean).join(' · ')
  return `${tab.history.length} executions${suffix ? ` · ${suffix}` : ''}`
})
const dbAiSql = computed(() => extractSql(dbAiText.value))
const dbAiIsConvertAction = computed(() => dbAiAction.value === 'convert')
const dbAiReasoningText = computed(() => {
  const fenceIndex = dbAiText.value.search(/```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|tsql)?\s*\n/i)
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
  if (dbAiStatus.value === 'streaming') return 'Streaming'
  if (dbAiStatus.value === 'cancelled') return 'Cancelled'
  if (dbAiStatus.value === 'done') return 'Done'
  return 'Idle'
})

const dbAiIsExecutableDialect = computed(() => {
  if (!dbAiIsConvertAction.value) return true
  const target = dbAiTargetDialect.value
  if (target === 'mssql') return false
  const tab = activeSqlTab.value
  const connection = tab ? findConnection(tab.connectionId) : undefined
  return connection?.dbType === target
})

const dbAiCanRunReadOnly = computed(() => Boolean(activeSqlCanRun.value && dbAiIsExecutableDialect.value && isReadOnlySql(dbAiSql.value)))
const dbAiCanCancel = computed(() => dbAiStatus.value === 'streaming')
const dbAiEmptyState = computed(() => dbAiOpen.value && !dbAiText.value.trim() && dbAiStatus.value === 'idle')

const visibleGroups = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return groups.value
  return groups.value.filter((group) => {
    if (group.name.toLowerCase().includes(needle)) return true
    return connections.value.some((connection) => connection.groupId === group.id && connectionText(connection).includes(needle))
  })
})

const filteredDataRows = computed(() => {
  const tab = activeDataTab.value
  if (!tab) return []
  return applySort(applyFilters(tab.rows, tab.filters), tab.sort)
})

const pagedDataRows = computed(() => {
  const tab = activeDataTab.value
  if (!tab) return []
  const start = (tab.page - 1) * tab.pageSize
  return filteredDataRows.value.slice(start, start + tab.pageSize)
})

const filteredSqlRows = computed(() => {
  const result = activeSqlResult.value
  if (!result || result.status === 'error') return []
  return applySort(applyFilters(result.rows, result.filters), result.sort)
})

const pagedSqlRows = computed(() => {
  const result = activeSqlResult.value
  if (!result || result.status === 'error') return []
  const start = (result.page - 1) * result.pageSize
  return filteredSqlRows.value.slice(start, start + result.pageSize)
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
  const scheme = connectionDraft.dbType === 'postgresql' ? 'jdbc:postgresql' : 'jdbc:mysql'
  return `${scheme}://${host}${port}${database}`
}

function markConnectionUrlAuto() {
  if (!connectionUrlDirty.value) connectionDraft.url = ''
}

const createDatabaseSql = computed({
  get() {
    if (createDatabaseModal.sql) return createDatabaseModal.sql
    if (!createDatabaseModal.name.trim()) return ''
    return `CREATE DATABASE ${quoteIdentifier(createDatabaseModal.name.trim())};`
  },
  set(value: string) {
    createDatabaseModal.sql = value
  }
})

watch(
  () => activeSqlTab.value?.connectionId,
  (connectionId) => {
    const tab = activeSqlTab.value
    if (!tab || !connectionId) return
    const connection = findConnection(connectionId)
    tab.catalogName = connection?.catalogs[0]?.name ?? ''
    tab.schemaName = connection?.catalogs[0]?.schemas?.[0]?.name ?? ''
  }
)

watch(dbAiTargetDialect, () => {
  if (!dbAiOpen.value || dbAiAction.value !== 'convert' || !dbAiSourceSql.value) return
  dbAiText.value = buildDbAiResponse('convert', dbAiSourceSql.value)
})

function connectionsByGroup(groupId: string) {
  const needle = keyword.value.trim().toLowerCase()
  const list = connections.value.filter((connection) => connection.groupId === groupId)
  if (!needle) return list
  return list.filter((connection) => connectionText(connection).includes(needle))
}

function connectionText(connection: MockDatabaseConnection) {
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

function toggleTable(tableId: string) {
  expandedTables.value = toggleId(expandedTables.value, tableId)
}

function isCatalogExpanded(connectionId: string, catalogName: string) {
  return expandedCatalogs.value.includes(`${connectionId}:${catalogName}`)
}

function isSchemaExpanded(connectionId: string, catalogName: string, schemaName: string) {
  return expandedSchemas.value.includes(`${connectionId}:${catalogName}:${schemaName}`)
}

function isTableExpanded(tableId: string) {
  return expandedTables.value.includes(tableId)
}

function toggleId(list: string[], id: string) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
}

function columnNodeId(tableId: string, columnName: string) {
  return `${tableId}:column:${columnName}`
}

function selectColumnNode(table: MockDatabaseTable, column: MockDatabaseColumn) {
  selectedNodeId.value = columnNodeId(table.id, column.name)
}

function findConnection(id: string) {
  return connections.value.find((connection) => connection.id === id)
}

function findTable(connectionId: string, catalogName: string, tableId: string, schemaName?: string) {
  const catalog = findConnection(connectionId)?.catalogs.find((item) => item.name === catalogName)
  if (!catalog) return null
  if (schemaName) return catalog.schemas?.find((schema) => schema.name === schemaName)?.tables.find((table) => table.id === tableId) ?? null
  return catalog.tables?.find((table) => table.id === tableId) ?? null
}

function tableByName(connection: MockDatabaseConnection | undefined, catalogName: string, schemaName: string | undefined, tableName: string) {
  const catalog = connection?.catalogs.find((item) => item.name === catalogName)
  if (!catalog) return null
  const normalized = tableName.replace(/[`";]/g, '').split('.').pop()?.trim().toLowerCase()
  if (!normalized) return null
  const tables = schemaName ? catalog.schemas?.find((schema) => schema.name === schemaName)?.tables : catalog.tables
  return tables?.find((table) => table.name.toLowerCase() === normalized) ?? null
}

function openTable(connectionId: string, catalogName: string, table: MockDatabaseTable, schemaName?: string) {
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
    rows: table.rows.map((row) => ({ ...row })),
    primaryKey: table.primaryKey,
    whereRaw: '',
    page: 1,
    pageSize: 100,
    filters: [],
    sort: null,
    selectedRowKey: null,
    durationMs: 18 + Math.floor(Math.random() * 20),
    dirtyState: makeDirtyState(table.rows.map((row) => ({ ...row })), table.primaryKey),
    undoStack: []
  }
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function closeTab(tabId: string) {
  const index = tabs.value.findIndex((tab) => tab.id === tabId)
  if (index <= 0) return
  tabs.value.splice(index, 1)
  if (activeTabId.value === tabId) activeTabId.value = tabs.value[Math.max(0, index - 1)]?.id ?? 'tab-overview'
}

function selectOverflowTab(tabId: string) {
  activeTabId.value = tabId
  overflowOpen.value = false
}

function openSqlConsole(connectionId = connections.value[0]?.id ?? '') {
  const connection = findConnection(connectionId)
  const catalog = connection?.catalogs[0]
  const schema = catalog?.schemas?.[0]
  const tab: WorkspaceTab = {
    id: `tab-sql-${Date.now()}`,
    kind: 'sql',
    title: connection ? `${connection.name} SQL` : 'SQL Console',
    connectionId,
    catalogName: catalog?.name ?? '',
    schemaName: schema?.name ?? '',
    sql: renderDefaultSql(connection, catalog, schema?.name),
    resultTabs: [],
    activeResultTabId: 'overview',
    history: []
  }
  tabs.value.push(tab)
  activeTabId.value = tab.id
  closeMenus()
}

function renderDefaultSql(connection: MockDatabaseConnection | undefined, catalog: MockDatabaseCatalog | undefined, schemaName?: string) {
  const table = schemaName ? catalog?.schemas?.find((schema) => schema.name === schemaName)?.tables[0] : catalog?.tables?.[0]
  if (!table) return 'select 1;'
  const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', catalog?.name ?? '', schemaName, table.name)
  return connection?.dbType === 'oracle' ? `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;` : `SELECT *\nFROM ${qualified}\nLIMIT 100;`
}

function buildQualifiedTableReference(dbType: MockDatabaseEngineCode, catalogName: string, schemaName: string | undefined, tableName: string) {
  const quotedTable = quoteSqlIdentifierForDialect(tableName, dbType)
  if ((dbType === 'postgresql' || dbType === 'oracle') && schemaName) {
    return `${quoteSqlIdentifierForDialect(schemaName, dbType)}.${quotedTable}`
  }
  if (dbType === 'sqlite' && catalogName) {
    return `${quoteSqlIdentifierForDialect(catalogName, dbType)}.${quotedTable}`
  }
  return quotedTable
}

function quoteSqlIdentifierForDialect(value: string, dbType: MockDatabaseEngineCode) {
  if (dbType === 'mysql') return `\`${String(value).replace(/`/g, '``')}\``
  return `"${String(value).replace(/"/g, '""')}"`
}

function quoteSqlIdentifierForDbAi(value: string, dialect: DbAiTargetDialect) {
  const raw = String(value).replace(/^[`"\[]|[`"\]]$/g, '')
  if (dialect === 'mysql') return `\`${raw.replace(/`/g, '``')}\``
  if (dialect === 'mssql') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}

function runSql(mode: 'all' | 'current' | 'explain') {
  const tab = activeSqlTab.value
  if (!tab || !activeSqlCanRun.value) return
  const sql = resolveSqlForRun(tab, mode)
  if (!sql.trim()) {
    showNotice('SQL is empty')
    return
  }
  appendSqlExecution(tab, sql)
}

function appendSqlExecution(tab: Extract<WorkspaceTab, { kind: 'sql' }>, sql: string) {
  const result = executeMockSql(tab, sql)
  tab.resultTabs.push(result)
  tab.activeResultTabId = result.id
  tab.history.unshift({
    id: `hist-${result.id}`,
    resultTabId: result.id,
    title: result.title,
    sql,
    message: result.error ? `failure: ${result.error}` : `successful: Affected rows ${result.rows.length}`,
    status: result.status === 'error' ? 'error' : 'ok',
    durationMs: result.durationMs,
    rowCount: result.rows.length,
    createdAt: formatSqlHistoryTime(new Date())
  })
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

function executeMockSql(tab: Extract<WorkspaceTab, { kind: 'sql' }>, sql: string): SqlResult {
  const seq = resultSeq.value++
  const idx = tab.resultTabs.length + 1
  const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 40) || 'SQL'
  const connection = findConnection(tab.connectionId)
  const tableMatch = sql.match(/from\s+([`"\w.]+)/i)
  const tableName = tableMatch?.[1] ?? ''
  const table = tableByName(connection, tab.catalogName, tab.schemaName, tableName)
  const isError = /drop\s+database|syntax_error/i.test(sql)
  if (isError) {
    return {
      id: `result-${seq}`,
      title: `#${seq}-${idx} ${preview}`,
      sql,
      status: 'error',
      columns: [],
      rows: [],
      durationMs: 22,
      error: 'Mock SQL parser rejected this statement.',
      page: 1,
      pageSize: 100,
      filters: [],
      sort: null
    }
  }
  const rows = table?.rows.map((row) => ({ ...row })) ?? [{ result: 1, message: 'mock query ok' }]
  const columns = table?.columns.map((column) => column.name) ?? Object.keys(rows[0] ?? {})
  return {
    id: `result-${seq}`,
    title: `#${seq}-${idx} ${preview}`,
    sql,
    status: 'ok',
    columns,
    rows,
    durationMs: 24 + Math.floor(Math.random() * 18),
    error: null,
    page: 1,
    pageSize: 100,
    filters: [],
    sort: null
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
  if (!editor) return ''
  return editor.value.slice(editor.selectionStart, editor.selectionEnd)
}

function getSqlCursorOffset() {
  const editor = sqlEditorRef.value
  if (!editor) return activeSqlTab.value?.sql.length ?? 0
  return editor.selectionStart
}

function getSqlSelectionRange(): TextRange {
  const editor = sqlEditorRef.value
  const length = activeSqlTab.value?.sql.length ?? 0
  if (!editor) return { start: length, end: length }
  const start = Math.max(0, Math.min(editor.selectionStart, editor.selectionEnd, length))
  const end = Math.max(0, Math.min(Math.max(editor.selectionStart, editor.selectionEnd), length))
  return { start, end }
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
  if (!tab) return
  const closedIndex = tab.resultTabs.findIndex((result) => result.id === resultId)
  tab.resultTabs = tab.resultTabs.filter((result) => result.id !== resultId)
  tab.history.forEach((item) => {
    if (item.resultTabId === resultId) item.resultTabId = null
  })
  if (tab.activeResultTabId === resultId) {
    const fallback = tab.resultTabs[Math.max(0, closedIndex - 1)] ?? tab.resultTabs[closedIndex] ?? null
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

function formatSqlHistoryTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function updateSqlResultPage(page: number) {
  const result = activeSqlResult.value
  if (!result) return
  result.page = clampPage(page, filteredSqlRows.value.length, result.pageSize)
}

function updateSqlResultPageSize(size: number) {
  const result = activeSqlResult.value
  if (!result) return
  result.pageSize = size
  result.page = clampPage(result.page, filteredSqlRows.value.length, result.pageSize)
}

function gotoLastSqlResultPage() {
  const result = activeSqlResult.value
  if (!result) return
  result.page = Math.max(1, Math.ceil(filteredSqlRows.value.length / result.pageSize))
}

function cycleSqlSort(column: string) {
  const result = activeSqlResult.value
  if (!result) return
  result.sort = nextSort(result.sort, column)
}

function applySqlFilter(column: string, filter: DbFilter | null) {
  const result = activeSqlResult.value
  if (!result) return
  result.filters = replaceFilter(result.filters, column, filter)
  result.page = 1
}

function updateDataPage(page: number) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.page = clampPage(page, filteredDataRows.value.length, tab.pageSize)
}

function updateDataPageSize(size: number) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.pageSize = size
  tab.page = clampPage(tab.page, filteredDataRows.value.length, tab.pageSize)
}

function gotoLastDataPage() {
  const tab = activeDataTab.value
  if (!tab) return
  tab.page = Math.max(1, Math.ceil(filteredDataRows.value.length / tab.pageSize))
}

function cycleDataSort(column: string) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.sort = nextSort(tab.sort, column)
}

function applyDataFilter(column: string, filter: DbFilter | null) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.filters = replaceFilter(tab.filters, column, filter)
  tab.page = 1
}

function applyWhere() {
  const tab = activeDataTab.value
  if (!tab) return
  const match = tab.whereRaw.match(/(\w+)\s*(=|<>|!=|like)\s*['"]?([^'"]+)['"]?/i)
  if (match) {
    tab.filters = [{ column: match[1], operator: match[2].toLowerCase() === 'like' ? 'like' : match[2] === '=' ? 'eq' : 'neq', value: match[3] }]
  } else if (!tab.whereRaw.trim()) {
    tab.filters = []
  }
  tab.page = 1
}

function updateDataCell(rowKey: string, column: string, value: string) {
  const tab = activeDataTab.value
  if (!tab) return
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
}

function updateNewDataRowCell(tmpId: string, column: string, value: string) {
  const tab = activeDataTab.value
  if (!tab) return
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const newRows = dirtyState.newRows.map((row) => (row.tmpId === tmpId ? { ...row, values: { ...row.values, [column]: value } } : row))
  if (!newRows.some((row) => row.tmpId === tmpId)) return
  tab.dirtyState = { ...dirtyState, newRows }
}

function setActiveDataSelectedRow(key: string) {
  const tab = activeDataTab.value
  if (!tab) return
  tab.selectedRowKey = key
}

function addDataRow() {
  const tab = activeDataTab.value
  if (!tab) return
  const dirtyState = cloneDirtyState(tab.dirtyState)
  const values: Record<string, unknown> = {}
  tab.columns.forEach((column) => {
    values[column] = null
  })
  const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  tab.dirtyState = { ...dirtyState, newRows: [...dirtyState.newRows, { tmpId, values }] }
  tab.undoStack = [...tab.undoStack, { kind: 'add', tmpId }]
  tab.selectedRowKey = tmpId
  showNotice('New row added locally')
}

function deleteSelectedDataRow() {
  const tab = activeDataTab.value
  if (!tab || !tab.selectedRowKey) return
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
  showNotice('Row marked for deletion')
}

function undoDataChanges() {
  const tab = activeDataTab.value
  if (!tab) return
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
  showNotice('Last data edit reverted')
}

function saveDataChanges() {
  const tab = activeDataTab.value
  if (!tab) return
  tab.rows = tab.rows
    .filter((row, index) => !tab.dirtyState.deletedRowKeys.has(buildRowKey(row, tab.primaryKey, index)))
    .map((row, index) => {
      const key = buildRowKey(row, tab.primaryKey, index)
      return { ...row, ...(tab.dirtyState.updatedCells.get(key) ?? {}) }
    })
  tab.rows.push(...tab.dirtyState.newRows.map((row) => ({ ...row.values })))
  tab.dirtyState = makeDirtyState(tab.rows, tab.primaryKey)
  tab.undoStack = []
  tab.selectedRowKey = null
  showNotice('Changes saved to local mock state')
}

function discardDataChanges() {
  const tab = activeDataTab.value
  if (!tab) return
  tab.dirtyState = makeDirtyState(tab.rows, tab.primaryKey)
  tab.undoStack = []
  tab.selectedRowKey = null
  showNotice('Local data edits discarded')
}

function copyDataMutationPreview() {
  const summary = activeDataEditSummary.value
  if (!summary?.preview) return
  copyText(summary.preview)
  showNotice('Mutation preview copied')
}

function refreshDataTab() {
  const tab = activeDataTab.value
  if (!tab) return
  tab.durationMs = 16 + Math.floor(Math.random() * 20)
  showNotice('Table data refreshed')
}

function makeDirtyState(rows: Array<Record<string, unknown>>, primaryKey: string[]): DirtyState {
  const originalRows = new Map<string, Record<string, unknown>>()
  rows.forEach((row, index) => {
    originalRows.set(buildRowKey(row, primaryKey, index), { ...row })
  })
  return {
    newRows: [],
    deletedRowKeys: new Set<string>(),
    updatedCells: new Map<string, Record<string, unknown>>(),
    originalRows
  }
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
  return {
    isDirty,
    newRows,
    updatedRows,
    deletedRows,
    undoDepth: tab.undoStack.length,
    preview: isDirty ? buildDataMutationPreview(tab) : ''
  }
}

function buildDataMutationPreview(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  const statements: string[] = []
  Array.from(tab.dirtyState.deletedRowKeys).forEach((rowKey) => {
    statements.push(buildDeletePreview(tab, rowKey))
  })
  Array.from(tab.dirtyState.updatedCells.entries()).forEach(([rowKey, patch]) => {
    const sql = buildUpdatePreview(tab, rowKey, patch)
    if (sql) statements.push(sql)
  })
  tab.dirtyState.newRows.forEach((row) => {
    const sql = buildInsertPreview(tab, row.values)
    if (sql) statements.push(sql)
  })
  return statements.join('\n')
}

function buildDeletePreview(tab: Extract<WorkspaceTab, { kind: 'data' }>, rowKey: string) {
  return `DELETE FROM ${dataTableReference(tab)} WHERE ${wherePreview(tab, rowKey)};`
}

function buildUpdatePreview(tab: Extract<WorkspaceTab, { kind: 'data' }>, rowKey: string, patch: Record<string, unknown>) {
  const columns = Object.keys(patch)
  if (!columns.length) return ''
  const assignments = columns.map((column) => `${quoteSqlIdentifier(column)} = ${formatSqlLiteral(patch[column])}`).join(', ')
  return `UPDATE ${dataTableReference(tab)} SET ${assignments} WHERE ${wherePreview(tab, rowKey)};`
}

function buildInsertPreview(tab: Extract<WorkspaceTab, { kind: 'data' }>, values: Record<string, unknown>) {
  const columns = tab.columns.filter((column) => values[column] !== null && values[column] !== undefined)
  if (!columns.length) return ''
  return `INSERT INTO ${dataTableReference(tab)} (${columns.map(quoteSqlIdentifier).join(', ')}) VALUES (${columns.map((column) => formatSqlLiteral(values[column])).join(', ')});`
}

function wherePreview(tab: Extract<WorkspaceTab, { kind: 'data' }>, rowKey: string) {
  const snapshot = tab.dirtyState.originalRows.get(rowKey)
  const pkValues = decodePrimaryKeyRowKey(rowKey, tab.primaryKey)
  if (tab.primaryKey.length && pkValues) {
    return tab.primaryKey.map((column, index) => compareSqlValue(column, pkValues[index])).join(' AND ')
  }
  if (!snapshot) return '1 = 0'
  return tab.columns.map((column) => compareSqlValue(column, snapshot[column])).join(' AND ')
}

function decodePrimaryKeyRowKey(rowKey: string, primaryKey: string[]) {
  if (!primaryKey.length) return null
  try {
    const parsed = JSON.parse(rowKey)
    return Array.isArray(parsed) && parsed.length === primaryKey.length ? parsed : null
  } catch {
    return null
  }
}

function compareSqlValue(column: string, value: unknown) {
  const quoted = quoteSqlIdentifier(column)
  return value === null || value === undefined ? `${quoted} IS NULL` : `${quoted} = ${formatSqlLiteral(value)}`
}

function dataTableReference(tab: Extract<WorkspaceTab, { kind: 'data' }>) {
  const connection = findConnection(tab.connectionId)
  const parts = connection?.dbType === 'mysql' || connection?.dbType === 'sqlite' ? [tab.catalogName, tab.tableName] : [tab.schemaName, tab.tableName]
  return parts.filter(Boolean).map((part) => quoteSqlIdentifier(String(part))).join('.')
}

function quoteSqlIdentifier(value: string) {
  const clean = DB_IDENT_RE.test(value) ? value : quoteIdentifier(value)
  return `"${clean}"`
}

function formatSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${String(value).replace(/'/g, "''")}'`
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

function toggleConnectionStatus(id: string) {
  const connection = findConnection(id)
  if (!connection) return
  connection.status = connection.status === 'connected' ? 'idle' : 'connected'
}

function refreshConnected() {
  connections.value.forEach((connection) => {
    if (connection.status === 'connected') connection.status = 'connected'
  })
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

function addGroup() {
  const id = `group-${Date.now()}`
  groups.value.push({ id, name: 'New Group' })
  expandedGroups.value.push(id)
  editingGroupId.value = id
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

function commitGroupRename() {
  const id = editingGroupId.value
  if (!id) return
  const group = groups.value.find((item) => item.id === id)
  if (group && editingGroupName.value.trim()) group.name = editingGroupName.value.trim()
  editingGroupId.value = null
  editingGroupName.value = ''
}

function cancelGroupRename() {
  editingGroupId.value = null
  editingGroupName.value = ''
}

function deleteGroup(groupId: string) {
  if (groupId === 'group-default') {
    showNotice('Default Group cannot be deleted')
    closeMenus()
    return
  }
  groups.value = groups.value.filter((group) => group.id !== groupId)
  connections.value.forEach((connection) => {
    if (connection.groupId === groupId) connection.groupId = 'group-default'
  })
  closeMenus()
}

function openContextMenu(event: MouseEvent, payload: ContextMenuPayload) {
  selectedNodeId.value =
    payload.type === 'group' ? payload.groupId : payload.type === 'connection' ? payload.connectionId : payload.tableId
  addMenuOpen.value = false
  contextMenu.value = { ...payload, x: event.clientX, y: event.clientY } as ContextMenu
}

function connectFromMenu(connectionId: string) {
  toggleConnectionStatus(connectionId)
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
    filePath: connection.filePath ?? '/tmp/aiopsterm/demo.db',
    readonly: !!connection.readonly,
    sslMode: connection.sslMode ?? '',
    url: connection.url ?? ''
  })
  connectionErrors.value = []
  connectionFeedback.value = ''
  connectionFeedbackKind.value = 'info'
  connectionUrlDirty.value = !!(connection.url && connection.url !== buildConnectionUrl())
  passwordVisible.value = false
  connectionModalOpen.value = true
  closeMenus()
}

function removeConnection(connectionId: string) {
  connections.value = connections.value.filter((connection) => connection.id !== connectionId)
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
    const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', menu.catalogName, menu.schemaName, menu.label)
    tab.sql =
      connection?.dbType === 'oracle' ? `SELECT *\nFROM ${qualified}\nFETCH FIRST 100 ROWS ONLY;` : `SELECT *\nFROM ${qualified}\nLIMIT 100;`
  }
  closeMenus()
}

function openDdlModalFromContext() {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  const table = findTable(menu.connectionId, menu.catalogName, menu.tableId, menu.schemaName)
  if (!table) return
  ddlModal.open = true
  ddlModal.tableName = table.name
  ddlModal.ddl = table.ddl
  closeMenus()
}

function copySelectSql() {
  const menu = contextMenu.value
  if (!menu || menu.type !== 'table') return
  const connection = findConnection(menu.connectionId)
  const qualified = buildQualifiedTableReference(connection?.dbType ?? 'mysql', menu.catalogName, menu.schemaName, menu.label)
  copyText(`SELECT * FROM ${qualified}`)
  showNotice('SELECT copied')
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

function confirmDangerousTableAction() {
  if (!dangerConfirm.open || dangerConfirm.confirmText !== dangerConfirm.tableName) return
  const connection = findConnection(dangerConfirm.connectionId)
  const context = [connection?.name, dangerConfirm.catalogName, dangerConfirm.schemaName, dangerConfirm.tableName].filter(Boolean).join(' · ')
  openDbAi(dangerConfirm.action, dangerConfirm.sql, context)
  dangerConfirm.open = false
  dangerConfirm.confirmText = ''
}

function copyContextName() {
  if (!contextMenu.value) return
  copyText(contextMenu.value.label)
  showNotice('Name copied')
  closeMenus()
}

function openConnectionModal(dbType: MockDatabaseEngineCode) {
  connectionModalMode.value = 'create'
  const defaultPort = dbType === 'postgresql' ? 5432 : dbType === 'oracle' ? 1521 : dbType === 'sqlite' ? null : 3306
  Object.assign(connectionDraft, {
    id: '',
    dbType,
    name: `${engineName(dbType).toLowerCase()}-connection`,
    env: 'Development',
    groupId: groups.value[0]?.id ?? 'group-default',
    host: '127.0.0.1',
    port: defaultPort,
    authentication: 'UserAndPassword',
    user: dbType === 'sqlite' ? '' : 'root',
    password: '',
    database: '',
    filePath: '/tmp/aiopsterm/demo.db',
    readonly: dbType === 'sqlite',
    sslMode: '',
    url: ''
  })
  connectionErrors.value = []
  connectionFeedback.value = ''
  connectionFeedbackKind.value = 'info'
  connectionUrlDirty.value = false
  passwordVisible.value = false
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
}

async function pickSqliteFile() {
  const result = await window.aiops?.showOpenDialog?.({
    properties: ['openFile'],
    filters: [
      { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  const filePath = result && !result.canceled ? result.filePaths?.[0] : ''
  if (!filePath) return
  connectionDraft.filePath = filePath
  markConnectionUrlAuto()
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
  }
  connectionErrors.value = errors
  return errors.length === 0
}

function testConnectionDraft() {
  if (!validateConnectionDraft()) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = 'Fix required fields before testing.'
    return
  }
  const version =
    connectionDraft.dbType === 'postgresql'
      ? 'PostgreSQL 16 mock'
      : connectionDraft.dbType === 'mysql'
        ? 'MySQL 8 mock'
        : connectionDraft.dbType === 'oracle'
          ? 'Oracle mock'
          : 'SQLite mock'
  connectionFeedbackKind.value = 'info'
  connectionFeedback.value = `Connection successful in local mock mode. (${version})`
}

function saveConnectionDraft() {
  if (!validateConnectionDraft()) {
    connectionFeedbackKind.value = 'error'
    connectionFeedback.value = 'Fix required fields before saving.'
    return
  }
  const existing = connectionDraft.id ? findConnection(connectionDraft.id) : null
  const normalized = normalizeConnectionDraft()
  if (existing) {
    Object.assign(existing, normalized, {
      hasPassword: connectionDraft.password ? true : existing.hasPassword
    })
  } else {
    const id = `conn-${Date.now()}`
    connections.value.push({
      id,
      ...normalized,
      hasPassword: !!connectionDraft.password,
      status: 'idle',
      catalogs: [{ name: normalized.database || 'sample', tables: [] }]
    })
    expandedConnections.value.push(id)
  }
  closeConnectionModal()
  showNotice('Connection saved')
}

function normalizeConnectionDraft(): Omit<MockDatabaseConnection, 'id' | 'status' | 'catalogs'> {
  const isSqlite = connectionDraft.dbType === 'sqlite'
  const hasOracleConnectString = connectionDraft.dbType === 'oracle' && !!connectionDraft.url.trim()
  return {
    name: connectionDraft.name.trim(),
    dbType: connectionDraft.dbType,
    env: connectionDraft.env,
    groupId: connectionDraft.groupId,
    host: isSqlite || hasOracleConnectString ? 'local' : connectionDraft.host.trim(),
    port: isSqlite || hasOracleConnectString ? null : connectionDraft.port,
    authentication: connectionDraft.authentication,
    user: isSqlite ? '' : connectionDraft.user.trim(),
    database: isSqlite ? connectionDraft.filePath.split('/').pop() || 'main' : connectionDraft.database.trim(),
    filePath: isSqlite ? connectionDraft.filePath.trim() : undefined,
    readonly: isSqlite ? connectionDraft.readonly : undefined,
    sslMode: connectionDraft.dbType === 'postgresql' ? connectionDraft.sslMode : '',
    url: isSqlite ? `sqlite://${connectionDraft.filePath.trim()}` : connectionDraft.url.trim()
  }
}

function openCreateDatabaseModal(connectionId: string) {
  createDatabaseModal.open = true
  createDatabaseModal.connectionId = connectionId
  createDatabaseModal.name = ''
  createDatabaseModal.sql = ''
  closeMenus()
}

function createDatabase() {
  const connection = findConnection(createDatabaseModal.connectionId)
  if (!connection) return
  connection.catalogs.push({ name: createDatabaseModal.name, tables: [] })
  createDatabaseModal.open = false
  showNotice('Database created in local mock state')
}

function copyDdl() {
  copyText(ddlModal.ddl)
  showNotice('DDL copied')
}

function openDbAiFromToolbar(action: Extract<DbAiAction, 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete'>) {
  const tab = activeSqlTab.value
  if (!tab) return
  const selected = getSelectedSqlText().trim()
  const current = currentSqlStatement(tab.sql, getSqlCursorOffset()).trim()
  const sourceSql = selected || current || tab.sql.trim()
  if (action !== 'nl2sql' && action !== 'complete' && !sourceSql) {
    showNotice('SQL is empty')
    return
  }
  const contextParts = buildDbAiContextParts(tab)
  contextParts.push(selected ? 'selection' : current ? 'current statement' : action === 'nl2sql' ? 'natural language prompt' : 'full editor')
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

function openDbAi(action: DbAiAction, sql: string, context = '') {
  if (dbAiTimer.value) {
    window.clearTimeout(dbAiTimer.value)
    dbAiTimer.value = null
  }
  dbAiAction.value = action
  dbAiActionLabel.value = dbAiActionName(action)
  dbAiStatus.value = 'streaming'
  dbAiContextSummary.value = context
  dbAiSourceSql.value = sql
  const activeDialect = activeSqlTab.value ? findConnection(activeSqlTab.value.connectionId)?.dbType : undefined
  if (action === 'convert') dbAiTargetDialect.value = activeDialect ?? 'postgresql'
  dbAiText.value = buildDbAiResponse(action, sql)
  dbAiOpen.value = true
  dbAiTimer.value = window.setTimeout(() => {
    dbAiStatus.value = 'done'
    dbAiTimer.value = null
  }, 220)
  closeMenus()
}

function copyDbAiSql() {
  copyText(dbAiSql.value)
  showNotice('Generated SQL copied')
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
  setEditorSql(dbAiSql.value, dbAiSql.value.length)
  appendSqlExecution(tab, dbAiSql.value)
  showNotice('Read-only SQL executed')
}

function cancelDbAiRequest() {
  if (dbAiTimer.value) {
    window.clearTimeout(dbAiTimer.value)
    dbAiTimer.value = null
  }
  dbAiStatus.value = 'cancelled'
  showNotice('DB AI request cancelled')
}

function clearDbAiRequest() {
  if (dbAiTimer.value) {
    window.clearTimeout(dbAiTimer.value)
    dbAiTimer.value = null
  }
  dbAiOpen.value = false
  dbAiText.value = ''
  dbAiSourceSql.value = ''
  dbAiStatus.value = 'idle'
  dbAiContextSummary.value = ''
}

function dbAiActionName(action: DbAiAction) {
  switch (action) {
    case 'explain':
      return 'Explain SQL'
    case 'nl2sql':
      return 'Natural Language to SQL'
    case 'optimize':
      return 'Optimize SQL'
    case 'convert':
      return 'Convert SQL'
    case 'complete':
      return 'Complete SQL'
    case 'diagnose':
      return 'Diagnose SQL'
    case 'truncate':
      return 'Truncate Table'
    case 'drop':
      return 'Drop Table'
    default:
      return action
  }
}

function buildDbAiResponse(action: DbAiAction, sql: string) {
  const generatedSql = buildDbAiGeneratedSql(action, sql)
  const notes = buildDbAiReasoning(action, sql, generatedSql)
  return `${notes}\n\n\`\`\`sql\n${generatedSql}\n\`\`\``
}

function buildDbAiReasoning(action: DbAiAction, sourceSql: string, generatedSql: string) {
  const lines = ['Reasoning', '- Read the active database context and selected editor range.']
  if (action === 'convert') {
    lines.push(`- Converted the SQL text to ${dbAiDialectLabel(dbAiTargetDialect.value)} syntax.`)
    lines.push(dbAiIsExecutableDialect.value ? '- Target dialect matches the active connection, so read-only execution can be enabled.' : '- Target dialect is text-only for this connection.')
  } else if (action === 'diagnose') {
    lines.push('- Built a conservative read-only statement that can verify the referenced table.')
  } else if (action === 'drop' || action === 'truncate') {
    lines.push('- Preserved the destructive SQL as generated text only; execution remains blocked by the read-only guard.')
  } else if (action === 'nl2sql') {
    lines.push('- Mapped the request to the first visible table in the current database context.')
  } else if (action === 'complete') {
    lines.push('- Completed the current statement with a bounded read-only predicate.')
  } else if (action === 'optimize') {
    lines.push('- Kept the query read-only and added a safer bounded projection for review.')
  } else {
    lines.push('- Kept the source SQL available for editor actions and review.')
  }
  lines.push(`- Generated SQL is ${isReadOnlySql(generatedSql) ? 'read-only' : 'not read-only'} before any execution action.`)
  if (sourceSql.trim() && sourceSql !== generatedSql) lines.push('- The original editor SQL remains unchanged until Copy, Replace, Insert, or Run ReadOnly is chosen.')
  return lines.join('\n')
}

function buildDbAiGeneratedSql(action: DbAiAction, sql: string) {
  switch (action) {
    case 'convert':
      return convertSqlToDialect(sql, dbAiTargetDialect.value)
    case 'diagnose':
      return buildDiagnosedSql(sql)
    case 'nl2sql':
      return buildNl2Sql()
    case 'complete':
      return completeSql(sql)
    case 'optimize':
      return optimizeSql(sql)
    case 'drop':
    case 'truncate':
    case 'explain':
    default:
      return ensureSqlTerminated(sql.trim() || 'SELECT 1')
  }
}

function buildNl2Sql() {
  const tableRef = buildDbAiTableReference(dbAiActiveDialect())
  if (dbAiActiveDialect() === 'oracle') {
    return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nFETCH FIRST 20 ROWS ONLY;`
  }
  return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nLIMIT 20;`
}

function completeSql(sql: string) {
  const dialect = dbAiActiveDialect()
  const base = stripSqlTerminator(sql.trim() || `SELECT *\nFROM ${buildDbAiTableReference(dialect)}`)
  let completed = base
  if (/\bwhere\s*$/i.test(completed)) {
    completed = `${completed} status = 'open'`
  } else if (!/\bwhere\b/i.test(completed) && /^\s*(select|with)\b/i.test(completed)) {
    completed = `${completed}\nWHERE status = 'open'`
  }
  return addDialectLimit(completed, dialect, 100)
}

function optimizeSql(sql: string) {
  const dialect = dbAiActiveDialect()
  const base = stripSqlTerminator(sql.trim() || `SELECT id, service, status, owner, updated_at\nFROM ${buildDbAiTableReference(dialect)}`)
  const compact = base.replace(/\bselect\s+\*/i, 'SELECT id, service, status, owner, updated_at')
  return addDialectLimit(compact, dialect, 100)
}

function convertSqlToDialect(sql: string, dialect: DbAiTargetDialect) {
  const normalized = stripSqlTerminator(sql.trim() || 'SELECT 1')
  const quoted = normalized
    .replace(/"([^"]+)"/g, (_match, value: string) => quoteSqlIdentifierForDbAi(value, dialect))
    .replace(/`([^`]+)`/g, (_match, value: string) => quoteSqlIdentifierForDbAi(value, dialect))
    .replace(/\[([^\]]+)\]/g, (_match, value: string) => quoteSqlIdentifierForDbAi(value, dialect))
  return addDialectLimit(quoted, dialect, extractSqlLimit(normalized) ?? 100)
}

function addDialectLimit(sql: string, dialect: DbAiTargetDialect, fallbackLimit: number) {
  const limit = extractSqlLimit(sql) ?? fallbackLimit
  let withoutLimit = stripSqlTerminator(sql)
    .replace(/\s+limit\s+\d+\s*$/i, '')
    .replace(/\s+fetch\s+first\s+\d+\s+rows\s+only\s*$/i, '')
  const topMatch = withoutLimit.match(/^\s*select\s+top\s*\(\s*(\d+)\s*\)\s+/i)
  if (topMatch) withoutLimit = withoutLimit.replace(/^\s*select\s+top\s*\(\s*\d+\s*\)\s+/i, 'SELECT ')
  if (dialect === 'oracle') return ensureSqlTerminated(`${withoutLimit}\nFETCH FIRST ${Number(topMatch?.[1] ?? limit)} ROWS ONLY`)
  if (dialect === 'mssql') return ensureSqlTerminated(withoutLimit.replace(/^\s*select\s+/i, `SELECT TOP (${Number(topMatch?.[1] ?? limit)}) `))
  return ensureSqlTerminated(`${withoutLimit}\nLIMIT ${Number(topMatch?.[1] ?? limit)}`)
}

function extractSqlLimit(sql: string) {
  const limitMatch = sql.match(/\blimit\s+(\d+)\b/i)
  if (limitMatch) return Number(limitMatch[1])
  const fetchMatch = sql.match(/\bfetch\s+first\s+(\d+)\s+rows\s+only\b/i)
  if (fetchMatch) return Number(fetchMatch[1])
  const topMatch = sql.match(/\btop\s*\(\s*(\d+)\s*\)/i)
  if (topMatch) return Number(topMatch[1])
  return null
}

function dbAiActiveDialect(): MockDatabaseEngineCode {
  const tab = activeSqlTab.value
  return (tab ? findConnection(tab.connectionId)?.dbType : undefined) ?? 'postgresql'
}

function buildDbAiTableReference(dialect: MockDatabaseEngineCode | DbAiTargetDialect) {
  const tab = activeSqlTab.value
  const connection = tab ? findConnection(tab.connectionId) : undefined
  const catalog = connection?.catalogs.find((item) => item.name === tab?.catalogName) ?? connection?.catalogs[0]
  const schema = tab?.schemaName ? catalog?.schemas?.find((item) => item.name === tab.schemaName) : catalog?.schemas?.[0]
  const table = schema?.tables[0] ?? catalog?.tables?.[0]
  const tableName = table?.name ?? 'orders'
  const schemaName = schema?.name || tab?.schemaName
  if ((dialect === 'postgresql' || dialect === 'oracle' || dialect === 'mssql') && schemaName) {
    return `${quoteSqlIdentifierForDbAi(schemaName, dialect)}.${quoteSqlIdentifierForDbAi(tableName, dialect)}`
  }
  return quoteSqlIdentifierForDbAi(tableName, dialect)
}

function dbAiDialectLabel(dialect: DbAiTargetDialect) {
  return dbAiDialectOptions.find((option) => option.value === dialect)?.label ?? dialect
}

function stripSqlTerminator(sql: string) {
  return sql.trim().replace(/;+$/, '').trim()
}

function ensureSqlTerminated(sql: string) {
  const trimmed = sql.trim()
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
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
  })
}

function buildDiagnosedSql(sql: string) {
  const tableMatch = sql.match(/from\s+([`"\w.]+)/i)
  const tableName = tableMatch?.[1]?.replace(/[`"]/g, '') || 'public.orders'
  return `SELECT *\nFROM ${tableName}\nLIMIT 100;`
}

function extractSql(text: string) {
  const match = text.match(/```(?:sql|mysql|postgresql|pgsql|sqlite|oracle|tsql)?\s*\n([\s\S]*?)```/i)
  return match?.[1].trim() ?? text
}

function engineAccent(code: MockDatabaseEngineCode) {
  return mockDatabaseEngines.find((engine) => engine.code === code)?.accent ?? '#8a94a6'
}

function engineName(code: MockDatabaseEngineCode) {
  return mockDatabaseEngines.find((engine) => engine.code === code)?.name ?? code
}

function quoteIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9_]/g, '_')
}

function closeMenus() {
  addMenuOpen.value = false
  contextMenu.value = null
  overflowOpen.value = false
}

function showNotice(text: string) {
  notice.value = text
  if (noticeTimer.value) window.clearTimeout(noticeTimer.value)
  noticeTimer.value = window.setTimeout(() => {
    notice.value = ''
    noticeTimer.value = null
  }, 1800)
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => undefined)
}

function handleWindowClick() {
  closeMenus()
}

onMounted(() => {
  window.addEventListener('click', handleWindowClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleWindowClick)
  if (noticeTimer.value) window.clearTimeout(noticeTimer.value)
  if (dbAiTimer.value) window.clearTimeout(dbAiTimer.value)
})

watch(editingGroupId, async (id) => {
  if (!id) return
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('.db-tree-edit')
  input?.focus()
  input?.select()
})
</script>
