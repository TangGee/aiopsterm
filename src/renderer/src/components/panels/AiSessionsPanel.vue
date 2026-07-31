<template>
  <section class="ai-sessions-panel">
    <header class="panel-header">
      <div>
        <h2>{{ t('module.aiSessions') }}</h2>
      </div>
      <div class="ai-sessions-header-actions">
        <button
          class="ai-sessions-icon-button"
          :title="t('aiSessions.create')"
          :aria-label="t('aiSessions.create')"
          @click="openCreateDialog()"
        >
          <Plus />
        </button>
        <button
          class="ai-sessions-icon-button"
          :title="t('aiSessions.refresh')"
          @click="workspace.refreshManagedAiSessions()"
        >
          <RefreshCw />
        </button>
      </div>
    </header>

    <section
      v-if="workspace.managedAiSessions.length"
      class="ai-sessions-mode-nav"
      :aria-label="t('aiSessions.mode.navigation')"
    >
      <button
        v-for="option in modeButtons"
        :key="option.key"
        type="button"
        class="ai-sessions-mode-button"
        :class="[`mode-${option.key}`, { active: option.active }]"
        :aria-label="option.label"
        :aria-pressed="option.active"
        :aria-current="option.active ? 'page' : undefined"
        @mouseenter="showModeTooltip(option, $event)"
        @mouseleave="hideModeTooltip"
        @focus="showModeTooltip(option, $event)"
        @blur="hideModeTooltip"
        @click="selectMode(option.key)"
      >
        <Inbox v-if="option.key === 'pending'" />
        <Activity v-else-if="option.key === 'running'" />
        <Archive v-else />
        <span
          v-if="option.count"
          class="ai-sessions-mode-count"
        >
          {{ option.count }}
        </span>
      </button>
    </section>

    <Teleport to="body">
      <span
        v-if="modeTooltip"
        class="ai-sessions-mode-tooltip"
        :style="{ left: `${modeTooltip.left}px`, top: `${modeTooltip.top}px` }"
      >
        <strong>{{ modeTooltip.label }}</strong>
        {{ modeTooltip.tooltip }}
      </span>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="createDialogOpen"
        ref="createDialogElement"
        class="ai-session-create-backdrop"
        role="presentation"
        tabindex="-1"
        @click.self="closeCreateDialog"
        @keydown.esc.prevent="closeCreateDialog"
      >
        <section
          class="ai-session-create-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="'ai-session-create-title'"
        >
          <header>
            <div>
              <h3 id="ai-session-create-title">{{ t('aiSessions.createTitle') }}</h3>
              <p>{{ t('aiSessions.createDescription') }}</p>
            </div>
            <button
              type="button"
              class="ai-session-create-close"
              :aria-label="t('common.close')"
              :disabled="createBusy"
              @click="closeCreateDialog"
            >
              <X />
            </button>
          </header>

          <div class="ai-session-create-field">
            <label>{{ t('aiSessions.directory') }}</label>
            <div class="ai-session-create-directory">
              <input
                ref="createDirectoryInput"
                v-model="createDirectory"
                :placeholder="t('aiSessions.directoryPlaceholder')"
                :disabled="createBusy"
                @input="createError = ''"
                @keydown.enter.prevent="startCreatedSession"
              />
              <button
                type="button"
                :disabled="createBusy"
                @click="chooseCreateDirectory"
              >
                <FolderOpen />
                {{ t('aiSessions.chooseDirectory') }}
              </button>
            </div>
            <small class="ai-session-create-directory-hint">{{ t('aiSessions.directoryHint') }}</small>
          </div>

          <div class="ai-session-create-field">
            <label>{{ t('aiSessions.agent') }}</label>
            <select
              v-model="createAgentSource"
              class="ai-session-create-agent-select"
              :disabled="createBusy || !createAgentOptions.length"
            >
              <option
                v-for="agent in createAgentOptions"
                :key="agent.source"
                :value="agent.source"
                :disabled="!agent.available"
              >
                {{ agent.label }} - {{ t(agent.statusKey) }}
              </option>
            </select>
            <div
              v-if="selectedCreateAgent"
              class="ai-session-create-agent-detail"
            >
              <span>{{ t('aiSessions.agentCommand') }}: {{ selectedCreateAgent.launchCommand }}</span>
              <span :class="{ ready: selectedCreateAgent.available }">{{ t(selectedCreateAgent.statusKey) }}</span>
            </div>
          </div>

          <div
            v-if="createError"
            class="ai-session-create-error"
          >
            {{ createError }}
          </div>

          <footer>
            <button
              type="button"
              class="ai-session-create-settings"
              @click="openAgentHookSettings"
            >
              {{ t('aiSessions.openHookSettings') }}
            </button>
            <span class="ai-session-create-footer-actions">
              <button
                type="button"
                :disabled="createBusy"
                @click="closeCreateDialog"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="button"
                class="primary"
                :disabled="!canCreateSession"
                @click="startCreatedSession"
              >
                {{ createBusy ? t('aiSessions.createStarting') : t('aiSessions.createSubmit') }}
              </button>
            </span>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="ai-session-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
        @contextmenu.prevent.stop
      >
        <button
          type="button"
          @click="openContextSessionContent"
        >
          <FileText />
          <span>{{ t('aiSessions.openContent') }}</span>
        </button>
        <button
          type="button"
          @click="locateContextSession"
        >
          <LocateFixed />
          <span>{{ contextMenuSession && canResumeSession(contextMenuSession) ? t('aiSessions.resume') : t('aiSessions.locateTerminal') }}</span>
        </button>
        <button
          v-if="contextMenuSession?.state === 'needsInput'"
          type="button"
          @click="markContextSessionHandled"
        >
          <Check />
          <span>{{ t('aiSessions.markHandled') }}</span>
        </button>
        <button
          type="button"
          class="danger"
          @click="clearContextSession"
        >
          <Trash2 />
          <span>{{ t('aiSessions.clearSession') }}</span>
        </button>
      </div>
    </Teleport>

    <div class="panel-search">
      <Search />
      <input
        v-model="query"
        :placeholder="searchPlaceholder"
      />
    </div>

    <div
      v-if="workspace.managedAiSessionsError"
      class="ai-sessions-error"
    >
      {{ workspace.managedAiSessionsError }}
    </div>

    <div class="ai-sessions-content">
      <div
        v-if="workspace.managedAiSessions.length"
        class="ai-sessions-section-header"
      >
        <span class="ai-sessions-section-title">
          <Inbox v-if="mode === 'pending'" />
          <Activity v-else-if="mode === 'running'" />
          <Archive v-else />
          <strong>{{ activeModeLabel }}</strong>
        </span>
        <span
          v-if="mode === 'pending'"
          class="ai-sessions-scope-label"
        >{{ activeScopeLabel }}</span>
        <span
          v-else
          class="ai-sessions-library-grouping"
          :aria-label="t('aiSessions.grouping')"
        >
          <button
            type="button"
            :class="{ active: libraryGrouping === 'project' }"
            :title="t('aiSessions.groupByProject')"
            :aria-label="t('aiSessions.groupByProject')"
            @click="selectLibraryGrouping('project')"
          >
            <FolderTree />
          </button>
          <button
            type="button"
            :class="{ active: libraryGrouping === 'agent' }"
            :title="t('aiSessions.groupByAgent')"
            :aria-label="t('aiSessions.groupByAgent')"
            @click="selectLibraryGrouping('agent')"
          >
            <Bot />
          </button>
          <button
            type="button"
            :class="{ active: libraryGrouping === 'time' }"
            :title="t('aiSessions.groupByTime')"
            :aria-label="t('aiSessions.groupByTime')"
            @click="selectLibraryGrouping('time')"
          >
            <List />
          </button>
        </span>
      </div>
      <div
        ref="sessionListElement"
        class="ai-sessions-list"
      >
        <template v-if="mode === 'running' && libraryGrouping !== 'time'">
          <section
            v-for="section in runningSections"
            :key="section.key"
            class="ai-session-library-section"
            :class="{ collapsed: isLibrarySectionCollapsed(section.key) }"
          >
            <button
              type="button"
              class="ai-session-library-section-header"
              :aria-expanded="!isLibrarySectionCollapsed(section.key)"
              @click="toggleLibrarySection(section.key)"
            >
              <span>
                <ChevronDown class="ai-session-library-chevron" />
                <FolderTree v-if="libraryGrouping === 'project'" />
                <Bot v-else />
                <strong>{{ section.label }}</strong>
              </span>
              <small class="ai-session-library-section-count">
                <span
                  v-if="section.pendingCount"
                  class="ai-session-library-state"
                  :title="t('aiSessions.filter.needsInput')"
                ></span>
                <span
                  v-else-if="section.runningCount"
                  class="ai-session-library-state dot-working"
                  :title="t('aiSessions.filter.working')"
                ></span>
                <span>{{ section.count }}</span>
                <span
                  v-if="section.childCount"
                  class="ai-session-library-child-count"
                  :title="t('aiSessions.childGroupCount', { count: section.childCount })"
                >
                  <GitBranch />
                  {{ section.childCount }}
                </span>
              </small>
            </button>
            <button
              v-if="libraryGrouping === 'project' && section.projectPath"
              type="button"
              class="ai-session-library-create"
              :title="t('aiSessions.createInProject')"
              :aria-label="t('aiSessions.createInProject')"
              @click.stop="openCreateDialog(section.projectPath)"
            >
              <Plus />
            </button>
            <template v-if="!isLibrarySectionCollapsed(section.key)">
              <template
                v-for="rows in [sessionRows(section.sessions)]"
                :key="`${section.key}:rows`"
              >
                <template
                  v-for="row in rows.rows"
                  :key="row.key"
                >
                  <div
                    class="ai-session-row library"
                    role="button"
                    tabindex="0"
                    :title="sessionRowTooltip(row.session)"
                    :class="{ active: sessionKey(row.session) === workspace.selectedManagedAiSessionKey, attention: row.session.state === 'needsInput' }"
                    @click="selectSession(row.session)"
                    @dblclick="resumeOrFocusSession(row.session)"
                    @contextmenu.prevent="openSessionContextMenu(row.session, $event)"
                    @keydown.enter.prevent="selectSession(row.session)"
                    @keydown.space.prevent="selectSession(row.session)"
                  >
                    <span class="ai-session-row-side">
                      <span :class="`ai-session-state dot-${sessionDotState(row.session)}`"></span>
                      <button
                        v-if="row.session.state === 'needsInput'"
                        type="button"
                        class="ai-session-handle"
                        :title="t('aiSessions.markHandled')"
                        :aria-label="t('aiSessions.markHandled')"
                        @click.stop="workspace.markManagedAiSessionHandled(row.session.source, row.session.id)"
                      >
                        <Check />
                      </button>
                    </span>
                    <span class="ai-session-row-body">
                      <span class="ai-session-row-title">
                        {{ sessionRowTitle(row.session) }}
                        <span
                          v-if="row.childSessions.length"
                          class="ai-session-row-child-count"
                          :title="t('aiSessions.childGroupCount', { count: row.childSessions.length })"
                        >
                          <GitBranch />
                          {{ row.childSessions.length }}
                        </span>
                      </span>
                      <span
                        v-if="sessionRowDetail(row.session)"
                        class="ai-session-row-detail"
                      >{{ sessionRowDetail(row.session) }}</span>
                      <span class="ai-session-row-meta">
                        <span class="ai-session-row-meta-main">{{ adaptiveSessionRowMeta(row.session) }}</span>
                      </span>
                    </span>
                  </div>
                  <div
                    v-if="row.childSessions.length"
                    class="ai-session-child-branch"
                    :class="{ expanded: isChildGroupExpanded(childGroupKey(row.session)) }"
                  >
                    <button
                      type="button"
                      class="ai-session-child-group-header"
                      :aria-expanded="isChildGroupExpanded(childGroupKey(row.session))"
                      @click="toggleChildGroup(childGroupKey(row.session))"
                    >
                      <span>
                        <ChevronDown class="ai-session-child-chevron" />
                        <GitBranch />
                        <strong>{{ t('aiSessions.childGroup') }}</strong>
                      </span>
                      <small>{{ row.childSessions.length }}</small>
                    </button>
                    <template v-if="isChildGroupExpanded(childGroupKey(row.session))">
                      <div
                        v-for="session in row.childSessions"
                        :key="`${session.source}:${session.id}`"
                        class="ai-session-row library child"
                        role="button"
                        tabindex="0"
                        :title="childSessionRowTooltip(session)"
                        :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey }"
                        @click="selectSession(session)"
                        @dblclick="resumeOrFocusSession(session)"
                        @contextmenu.prevent="openSessionContextMenu(session, $event)"
                        @keydown.enter.prevent="selectSession(session)"
                        @keydown.space.prevent="selectSession(session)"
                      >
                        <span class="ai-session-row-child-rail">
                          <GitBranch />
                        </span>
                        <span class="ai-session-row-body">
                          <span class="ai-session-row-title">
                            {{ sessionRowTitle(session) }}
                            <span class="ai-session-row-kind">{{ sessionKindLabel(session) }}</span>
                          </span>
                          <span
                            v-if="sessionRowDetail(session)"
                            class="ai-session-row-detail"
                          >{{ sessionRowDetail(session) }}</span>
                          <span class="ai-session-row-meta">
                            <span class="ai-session-row-meta-main">{{ childSessionRowMeta(session) }}</span>
                          </span>
                        </span>
                      </div>
                    </template>
                  </div>
                </template>
                <div
                  v-if="rows.orphanChildSessions.length"
                  class="ai-session-child-branch orphan"
                  :class="{ expanded: isChildGroupExpanded(sectionOrphanChildGroupKey(section.key)) }"
                >
                  <button
                    type="button"
                    class="ai-session-child-group-header"
                    :aria-expanded="isChildGroupExpanded(sectionOrphanChildGroupKey(section.key))"
                    @click="toggleChildGroup(sectionOrphanChildGroupKey(section.key))"
                  >
                    <span>
                      <ChevronDown class="ai-session-child-chevron" />
                      <GitBranch />
                      <strong>{{ t('aiSessions.orphanChildGroup') }}</strong>
                    </span>
                    <small>{{ rows.orphanChildSessions.length }}</small>
                  </button>
                  <template v-if="isChildGroupExpanded(sectionOrphanChildGroupKey(section.key))">
                    <div
                      v-for="session in rows.orphanChildSessions"
                      :key="`${session.source}:${session.id}`"
                      class="ai-session-row library child"
                      role="button"
                      tabindex="0"
                      :title="childSessionRowTooltip(session)"
                      :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey }"
                      @click="selectSession(session)"
                      @dblclick="resumeOrFocusSession(session)"
                      @contextmenu.prevent="openSessionContextMenu(session, $event)"
                      @keydown.enter.prevent="selectSession(session)"
                      @keydown.space.prevent="selectSession(session)"
                    >
                      <span class="ai-session-row-child-rail">
                        <GitBranch />
                      </span>
                      <span class="ai-session-row-body">
                        <span class="ai-session-row-title">
                          {{ sessionRowTitle(session) }}
                          <span class="ai-session-row-kind">{{ sessionKindLabel(session) }}</span>
                        </span>
                        <span
                          v-if="sessionRowDetail(session)"
                          class="ai-session-row-detail"
                        >{{ sessionRowDetail(session) }}</span>
                        <span class="ai-session-row-meta">
                          <span class="ai-session-row-meta-main">{{ childSessionRowMeta(session) }}</span>
                        </span>
                      </span>
                    </div>
                  </template>
                </div>
              </template>
            </template>
          </section>
        </template>
        <template v-else-if="mode === 'library' && libraryGrouping !== 'time'">
          <section
            v-for="section in librarySections"
            :key="section.key"
            class="ai-session-library-section"
            :class="{ collapsed: isLibrarySectionCollapsed(section.key) }"
          >
            <button
              type="button"
              class="ai-session-library-section-header"
              :aria-expanded="!isLibrarySectionCollapsed(section.key)"
              @click="toggleLibrarySection(section.key)"
            >
              <span>
                <ChevronDown class="ai-session-library-chevron" />
                <FolderTree v-if="libraryGrouping === 'project'" />
                <Bot v-else />
                <strong>{{ section.label }}</strong>
              </span>
              <small class="ai-session-library-section-count">
                <span
                  v-if="section.pendingCount"
                  class="ai-session-library-state"
                  :title="t('aiSessions.filter.needsInput')"
                ></span>
                <span
                  v-else-if="section.runningCount"
                  class="ai-session-library-state dot-working"
                  :title="t('aiSessions.filter.working')"
                ></span>
                <span>{{ section.count }}</span>
                <span
                  v-if="section.childCount"
                  class="ai-session-library-child-count"
                  :title="t('aiSessions.childGroupCount', { count: section.childCount })"
                >
                  <GitBranch />
                  {{ section.childCount }}
                </span>
              </small>
            </button>
            <button
              v-if="libraryGrouping === 'project' && section.projectPath"
              type="button"
              class="ai-session-library-create"
              :title="t('aiSessions.createInProject')"
              :aria-label="t('aiSessions.createInProject')"
              @click.stop="openCreateDialog(section.projectPath)"
            >
              <Plus />
            </button>
            <template v-if="!isLibrarySectionCollapsed(section.key)">
              <template
                v-for="rows in [sessionRows(section.sessions)]"
                :key="`${section.key}:rows`"
              >
                <template
                  v-for="row in rows.rows"
                  :key="row.key"
                >
                  <div
                    class="ai-session-row library"
                    role="button"
                    tabindex="0"
                    :title="sessionRowTooltip(row.session)"
                    :class="{ active: sessionKey(row.session) === workspace.selectedManagedAiSessionKey, attention: row.session.state === 'needsInput' }"
                    @click="selectSession(row.session)"
                    @dblclick="resumeOrFocusSession(row.session)"
                    @contextmenu.prevent="openSessionContextMenu(row.session, $event)"
                    @keydown.enter.prevent="selectSession(row.session)"
                    @keydown.space.prevent="selectSession(row.session)"
                  >
                    <span class="ai-session-row-side">
                      <span :class="`ai-session-state dot-${sessionDotState(row.session)}`"></span>
                      <button
                        v-if="row.session.state === 'needsInput'"
                        type="button"
                        class="ai-session-handle"
                        :title="t('aiSessions.markHandled')"
                        :aria-label="t('aiSessions.markHandled')"
                        @click.stop="workspace.markManagedAiSessionHandled(row.session.source, row.session.id)"
                      >
                        <Check />
                      </button>
                    </span>
                    <span class="ai-session-row-body">
                      <span class="ai-session-row-title">
                        {{ sessionRowTitle(row.session) }}
                        <span
                          v-if="row.childSessions.length"
                          class="ai-session-row-child-count"
                          :title="t('aiSessions.childGroupCount', { count: row.childSessions.length })"
                        >
                          <GitBranch />
                          {{ row.childSessions.length }}
                        </span>
                      </span>
                      <span
                        v-if="sessionRowDetail(row.session)"
                        class="ai-session-row-detail"
                      >{{ sessionRowDetail(row.session) }}</span>
                      <span class="ai-session-row-meta">
                        <span class="ai-session-row-meta-main">{{ adaptiveSessionRowMeta(row.session) }}</span>
                      </span>
                    </span>
                  </div>
                  <div
                    v-if="row.childSessions.length"
                    class="ai-session-child-branch"
                    :class="{ expanded: isChildGroupExpanded(childGroupKey(row.session)) }"
                  >
                    <button
                      type="button"
                      class="ai-session-child-group-header"
                      :aria-expanded="isChildGroupExpanded(childGroupKey(row.session))"
                      @click="toggleChildGroup(childGroupKey(row.session))"
                    >
                      <span>
                        <ChevronDown class="ai-session-child-chevron" />
                        <GitBranch />
                        <strong>{{ t('aiSessions.childGroup') }}</strong>
                      </span>
                      <small>{{ row.childSessions.length }}</small>
                    </button>
                    <template v-if="isChildGroupExpanded(childGroupKey(row.session))">
                      <div
                        v-for="session in row.childSessions"
                        :key="`${session.source}:${session.id}`"
                        class="ai-session-row library child"
                        role="button"
                        tabindex="0"
                        :title="childSessionRowTooltip(session)"
                        :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey }"
                        @click="selectSession(session)"
                        @dblclick="resumeOrFocusSession(session)"
                        @contextmenu.prevent="openSessionContextMenu(session, $event)"
                        @keydown.enter.prevent="selectSession(session)"
                        @keydown.space.prevent="selectSession(session)"
                      >
                        <span class="ai-session-row-child-rail">
                          <GitBranch />
                        </span>
                        <span class="ai-session-row-body">
                          <span class="ai-session-row-title">
                            {{ sessionRowTitle(session) }}
                            <span class="ai-session-row-kind">{{ sessionKindLabel(session) }}</span>
                          </span>
                          <span
                            v-if="sessionRowDetail(session)"
                            class="ai-session-row-detail"
                          >{{ sessionRowDetail(session) }}</span>
                          <span class="ai-session-row-meta">
                            <span class="ai-session-row-meta-main">{{ childSessionRowMeta(session) }}</span>
                          </span>
                        </span>
                      </div>
                    </template>
                  </div>
                </template>
                <div
                  v-if="rows.orphanChildSessions.length"
                  class="ai-session-child-branch orphan"
                  :class="{ expanded: isChildGroupExpanded(sectionOrphanChildGroupKey(section.key)) }"
                >
                  <button
                    type="button"
                    class="ai-session-child-group-header"
                    :aria-expanded="isChildGroupExpanded(sectionOrphanChildGroupKey(section.key))"
                    @click="toggleChildGroup(sectionOrphanChildGroupKey(section.key))"
                  >
                    <span>
                      <ChevronDown class="ai-session-child-chevron" />
                      <GitBranch />
                      <strong>{{ t('aiSessions.orphanChildGroup') }}</strong>
                    </span>
                    <small>{{ rows.orphanChildSessions.length }}</small>
                  </button>
                  <template v-if="isChildGroupExpanded(sectionOrphanChildGroupKey(section.key))">
                    <div
                      v-for="session in rows.orphanChildSessions"
                      :key="`${session.source}:${session.id}`"
                      class="ai-session-row library child"
                      role="button"
                      tabindex="0"
                      :title="childSessionRowTooltip(session)"
                      :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey }"
                      @click="selectSession(session)"
                      @dblclick="resumeOrFocusSession(session)"
                      @contextmenu.prevent="openSessionContextMenu(session, $event)"
                      @keydown.enter.prevent="selectSession(session)"
                      @keydown.space.prevent="selectSession(session)"
                    >
                      <span class="ai-session-row-child-rail">
                        <GitBranch />
                      </span>
                      <span class="ai-session-row-body">
                        <span class="ai-session-row-title">
                          {{ sessionRowTitle(session) }}
                          <span class="ai-session-row-kind">{{ sessionKindLabel(session) }}</span>
                        </span>
                        <span
                          v-if="sessionRowDetail(session)"
                          class="ai-session-row-detail"
                        >{{ sessionRowDetail(session) }}</span>
                        <span class="ai-session-row-meta">
                          <span class="ai-session-row-meta-main">{{ childSessionRowMeta(session) }}</span>
                        </span>
                      </span>
                    </div>
                  </template>
                </div>
              </template>
            </template>
          </section>
        </template>
        <template v-else>
          <template
            v-for="rows in [sessionRows(visibleSessions)]"
            :key="`flat:${mode}:rows`"
          >
            <template
              v-for="row in rows.rows"
              :key="row.key"
            >
              <div
                class="ai-session-row"
                role="button"
                tabindex="0"
                :title="sessionRowTooltip(row.session)"
                :class="{ active: sessionKey(row.session) === workspace.selectedManagedAiSessionKey, attention: row.session.state === 'needsInput' }"
                @click="selectSession(row.session)"
                @dblclick="resumeOrFocusSession(row.session)"
                @contextmenu.prevent="openSessionContextMenu(row.session, $event)"
                @keydown.enter.prevent="selectSession(row.session)"
                @keydown.space.prevent="selectSession(row.session)"
              >
                <span class="ai-session-row-side">
                  <span :class="`ai-session-state dot-${sessionDotState(row.session)}`"></span>
                  <button
                    v-if="row.session.state === 'needsInput'"
                    type="button"
                    class="ai-session-handle"
                    :title="t('aiSessions.markHandled')"
                    :aria-label="t('aiSessions.markHandled')"
                    @click.stop="workspace.markManagedAiSessionHandled(row.session.source, row.session.id)"
                  >
                    <Check />
                  </button>
                </span>
                <span class="ai-session-row-body">
                  <span class="ai-session-row-title">
                    {{ sessionRowTitle(row.session) }}
                    <span
                      v-if="row.childSessions.length"
                      class="ai-session-row-child-count"
                      :title="t('aiSessions.childGroupCount', { count: row.childSessions.length })"
                    >
                      <GitBranch />
                      {{ row.childSessions.length }}
                    </span>
                  </span>
                  <span
                    v-if="sessionRowDetail(row.session)"
                    class="ai-session-row-detail"
                  >{{ sessionRowDetail(row.session) }}</span>
                  <span class="ai-session-row-meta">
                    <span class="ai-session-row-meta-main">{{ adaptiveSessionRowMeta(row.session) }}</span>
                  </span>
                </span>
              </div>
              <div
                v-if="row.childSessions.length"
                class="ai-session-child-branch flat"
                :class="{ expanded: isChildGroupExpanded(childGroupKey(row.session)) }"
              >
                <button
                  type="button"
                  class="ai-session-child-group-header"
                  :aria-expanded="isChildGroupExpanded(childGroupKey(row.session))"
                  @click="toggleChildGroup(childGroupKey(row.session))"
                >
                  <span>
                    <ChevronDown class="ai-session-child-chevron" />
                    <GitBranch />
                    <strong>{{ t('aiSessions.childGroup') }}</strong>
                  </span>
                  <small>{{ row.childSessions.length }}</small>
                </button>
                <template v-if="isChildGroupExpanded(childGroupKey(row.session))">
                  <div
                    v-for="session in row.childSessions"
                    :key="`${session.source}:${session.id}`"
                    class="ai-session-row child"
                    role="button"
                    tabindex="0"
                    :title="childSessionRowTooltip(session)"
                    :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey }"
                    @click="selectSession(session)"
                    @dblclick="resumeOrFocusSession(session)"
                    @contextmenu.prevent="openSessionContextMenu(session, $event)"
                    @keydown.enter.prevent="selectSession(session)"
                    @keydown.space.prevent="selectSession(session)"
                  >
                    <span class="ai-session-row-child-rail">
                      <GitBranch />
                    </span>
                    <span class="ai-session-row-body">
                      <span class="ai-session-row-title">
                        {{ sessionRowTitle(session) }}
                        <span class="ai-session-row-kind">{{ sessionKindLabel(session) }}</span>
                      </span>
                      <span
                        v-if="sessionRowDetail(session)"
                        class="ai-session-row-detail"
                      >{{ sessionRowDetail(session) }}</span>
                      <span class="ai-session-row-meta">
                        <span class="ai-session-row-meta-main">{{ childSessionRowMeta(session) }}</span>
                      </span>
                    </span>
                  </div>
                </template>
              </div>
            </template>
            <div
              v-if="rows.orphanChildSessions.length"
              class="ai-session-child-branch flat orphan"
              :class="{ expanded: isChildGroupExpanded(flatOrphanChildGroupKey()) }"
            >
              <button
                type="button"
                class="ai-session-child-group-header"
                :aria-expanded="isChildGroupExpanded(flatOrphanChildGroupKey())"
                @click="toggleChildGroup(flatOrphanChildGroupKey())"
              >
                <span>
                  <ChevronDown class="ai-session-child-chevron" />
                  <GitBranch />
                  <strong>{{ t('aiSessions.orphanChildGroup') }}</strong>
                </span>
                <small>{{ rows.orphanChildSessions.length }}</small>
              </button>
              <template v-if="isChildGroupExpanded(flatOrphanChildGroupKey())">
                <div
                  v-for="session in rows.orphanChildSessions"
                  :key="`${session.source}:${session.id}`"
                  class="ai-session-row child"
                  role="button"
                  tabindex="0"
                  :title="childSessionRowTooltip(session)"
                  :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey }"
                  @click="selectSession(session)"
                  @dblclick="resumeOrFocusSession(session)"
                  @contextmenu.prevent="openSessionContextMenu(session, $event)"
                  @keydown.enter.prevent="selectSession(session)"
                  @keydown.space.prevent="selectSession(session)"
                >
                  <span class="ai-session-row-child-rail">
                    <GitBranch />
                  </span>
                  <span class="ai-session-row-body">
                    <span class="ai-session-row-title">
                      {{ sessionRowTitle(session) }}
                      <span class="ai-session-row-kind">{{ sessionKindLabel(session) }}</span>
                    </span>
                    <span
                      v-if="sessionRowDetail(session)"
                      class="ai-session-row-detail"
                    >{{ sessionRowDetail(session) }}</span>
                    <span class="ai-session-row-meta">
                      <span class="ai-session-row-meta-main">{{ childSessionRowMeta(session) }}</span>
                    </span>
                  </span>
                </div>
              </template>
            </div>
          </template>
        </template>
        <div
          v-if="visibleSessions.length === 0"
          class="ai-sessions-empty"
        >
          <p>{{ t('aiSessions.emptyTitle') }}</p>
          <small>{{ t('aiSessions.emptyDescription') }}</small>
          <button
            class="ai-sessions-empty-action"
            @click="openCreateDialog()"
          >
            <Plus />
            {{ t('aiSessions.create') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { Activity, Archive, Bot, Check, ChevronDown, FileText, FolderOpen, FolderTree, GitBranch, Inbox, List, LocateFixed, Plus, RefreshCw, Search, Trash2, X } from 'lucide-vue-next'
import type { ManagedAiPanelModeButton } from '@/services/ai/aiSessionsPanelViewRuntime'
import { useAiSessionsPanelRuntime } from '@/services/ai/aiSessionsPanelRuntime'

const {
  workspace,
  t,
  query,
  mode,
  libraryGrouping,
  createDialogOpen,
  createDirectory,
  createAgentSource,
  createAgentOptions,
  selectedCreateAgent,
  createBusy,
  createError,
  canCreateSession,
  openCreateDialog,
  closeCreateDialog,
  chooseCreateDirectory,
  startCreatedSession,
  openAgentHookSettings,
  modeButtons,
  contextMenu,
  contextMenuSession,
  activeModeLabel,
  searchPlaceholder,
  sessionKey,
  selectMode,
  openSessionContextMenu,
  closeSessionContextMenu,
  openContextSessionContent,
  locateContextSession,
  markContextSessionHandled,
  clearContextSession,
  selectLibraryGrouping,
  isLibrarySectionCollapsed,
  toggleLibrarySection,
  visibleSessions,
  librarySections,
  runningSections,
  activeScopeLabel,
  selectSession,
  resumeOrFocusSession,
  sessionRowTooltip,
  sessionRowTitle,
  sessionRowDetail,
  sessionRowMeta,
  sessionRowMetaCandidates,
  sessionDotState,
  canResumeSession,
  isChildGroupExpanded,
  toggleChildGroup,
  childGroupKey,
  sessionRows,
  sectionOrphanChildGroupKey,
  flatOrphanChildGroupKey,
  sessionKindLabel,
  childSessionRowMeta,
  childSessionRowTooltip
} = useAiSessionsPanelRuntime()

const sessionListElement = ref<HTMLElement | null>(null)
const createDialogElement = ref<HTMLElement | null>(null)
const createDirectoryInput = ref<HTMLInputElement | null>(null)
const rowMetaWidth = ref(0)
let measureCanvasContext: CanvasRenderingContext2D | null = null
let listResizeObserver: ResizeObserver | null = null
let documentListenersAttached = false

const rowMetaSignature = computed(() => workspace.sortedManagedAiSessions.map((session) => `${sessionKey(session)}:${session.gitBranch || ''}:${session.gitDirty ? 1 : 0}:${session.canonicalCwd || session.cwd || ''}:${session.lastActivityAt}`).join('|'))

const measureRowMetaText = (text: string) => {
  if (!measureCanvasContext && typeof document !== 'undefined') {
    measureCanvasContext = document.createElement('canvas').getContext('2d')
  }
  if (!measureCanvasContext) return text.length * 7
  measureCanvasContext.font = '10px sans-serif'
  return measureCanvasContext.measureText(text).width
}

const updateRowMetaWidth = () => {
  const width = sessionListElement.value?.clientWidth || sessionListElement.value?.getBoundingClientRect().width || 0
  const nextWidth = Math.max(0, Math.floor(width - 64))
  if (rowMetaWidth.value !== nextWidth) rowMetaWidth.value = nextWidth
}

const adaptiveSessionRowMeta = (session: Parameters<typeof sessionRowMeta>[0]) => {
  const candidates = sessionRowMetaCandidates(session)
  const fallback = candidates.at(-1) || sessionRowMeta(session)
  const width = rowMetaWidth.value
  if (width <= 0) return fallback
  return candidates.find((candidate) => measureRowMetaText(candidate) <= width) || fallback
}

const stopPanelSurfaceObservers = () => {
  listResizeObserver?.disconnect()
  listResizeObserver = null
  if (documentListenersAttached) {
    document.removeEventListener('click', closeSessionContextMenu)
    document.removeEventListener('keydown', closeContextMenuOnEscape)
    documentListenersAttached = false
  }
}

const startPanelSurfaceObservers = () => {
  updateRowMetaWidth()
  if (!documentListenersAttached) {
    document.addEventListener('click', closeSessionContextMenu)
    document.addEventListener('keydown', closeContextMenuOnEscape)
    documentListenersAttached = true
  }
  if (typeof ResizeObserver === 'undefined' || !sessionListElement.value) return
  listResizeObserver?.disconnect()
  listResizeObserver = new ResizeObserver(updateRowMetaWidth)
  listResizeObserver.observe(sessionListElement.value)
}

const hideModeTooltip = () => {
  modeTooltip.value = null
}

const deactivatePanelSurface = () => {
  stopPanelSurfaceObservers()
  closeSessionContextMenu()
  hideModeTooltip()
}

watch(rowMetaSignature, () => {
  void nextTick(updateRowMetaWidth)
})

watch(createDialogOpen, (open) => {
  if (open) void nextTick(() => (createDirectoryInput.value || createDialogElement.value)?.focus())
})

onMounted(startPanelSurfaceObservers)
onActivated(startPanelSurfaceObservers)
onDeactivated(deactivatePanelSurface)
onBeforeUnmount(deactivatePanelSurface)

const closeContextMenuOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeSessionContextMenu()
}

const modeTooltip = ref<{ label: string; tooltip: string; left: number; top: number } | null>(null)

const showModeTooltip = (option: ManagedAiPanelModeButton, event: Event) => {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  const tooltipWidth = 190
  const viewportPadding = 8
  const left = Math.min(
    Math.max(rect.right + 10, viewportPadding),
    Math.max(viewportPadding, window.innerWidth - tooltipWidth - viewportPadding)
  )
  const top = Math.min(
    Math.max(rect.top + rect.height / 2, viewportPadding),
    Math.max(viewportPadding, window.innerHeight - 48)
  )
  modeTooltip.value = {
    label: option.label,
    tooltip: option.tooltip,
    left,
    top
  }
}

</script>
