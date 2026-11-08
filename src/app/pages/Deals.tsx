import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { Calendar, Handshake, LayoutGrid, List, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { DealForm } from '../components/forms'
import { ActivityFeed, FilesPanel, NoteComposer } from '../components/records'
import { Avatar, Badge, Button, CompanyMark, ConfirmDialog, Drawer, EmptyState, PageHeader, Skeleton } from '../components/ui'
import { api, useApiMutation, useDeal, useDeals } from '../lib/api'
import { cx } from '../lib/cx'
import { money, moneyCompact, shortDate } from '../lib/format'
import { DEAL_STAGES, type Deal, type DealStage } from '../../shared/types'

const stageDot: Record<DealStage, string> = {
  lead: 'bg-line-strong',
  qualified: 'bg-[#9d99f0]',
  proposal: 'bg-accent',
  negotiation: 'bg-info',
  won: 'bg-success',
  lost: 'bg-danger',
}

const HIDDEN_STAGES_KEY = 'relay.hidden-stages'
const DELETE_ZONE_ID = 'deal-delete-zone'

// Only treat the delete zone as a target when the pointer is actually inside
// it; nearest-corner detection could otherwise delete a card dropped beside it.
const collisionDetection: CollisionDetection = (args) => {
  const hit = pointerWithin(args).find((collision) => collision.id === DELETE_ZONE_ID)
  if (hit) return [hit]
  return closestCorners(args).filter((collision) => collision.id !== DELETE_ZONE_ID)
}

function readHiddenStages(): DealStage[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_STAGES_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((key): key is DealStage => DEAL_STAGES.some((stage) => stage.key === key)) : []
  } catch {
    return []
  }
}

function persistHiddenStages(stages: DealStage[]) {
  try {
    if (stages.length) window.localStorage.setItem(HIDDEN_STAGES_KEY, JSON.stringify(stages))
    else window.localStorage.removeItem(HIDDEN_STAGES_KEY)
  } catch {
    // Browsers can block storage; hiding still works for this visit.
  }
}

export function Deals() {
  const { data, isLoading } = useDeals()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'board' | 'list'>('board')
  const [creating, setCreating] = useState<DealStage | null>(null)
  const selected = params.get('deal')
  const [deleting, setDeleting] = useState<Deal | null>(null)
  const [hiddenStages, setHiddenStages] = useState<DealStage[]>(readHiddenStages)
  const visibleStages = DEAL_STAGES.filter((stage) => !hiddenStages.includes(stage.key))
  const hideStage = (stage: DealStage) => {
    setHiddenStages((prev) => {
      if (prev.includes(stage)) return prev
      const next = [...prev, stage]
      persistHiddenStages(next)
      return next
    })
  }
  const showAllStages = () => {
    setHiddenStages([])
    persistHiddenStages([])
  }
  const remove = useApiMutation((id: string) => api(`/deals/${id}`, { method: 'DELETE' }), ['deals', 'deal', 'overview', 'contact', 'company'], {
    onSuccess: () => setDeleting(null),
  })

  const items = data?.items ?? []
  const open = items.filter((d) => !['won', 'lost'].includes(d.stage))

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-[1400px] px-5 pt-5 sm:px-8 sm:pt-8">
        <PageHeader
          title="Deals"
          subtitle={data ? `${money(open.reduce((s, d) => s + d.value, 0))} across ${open.length} open deals` : undefined}
          actions={
            <>
              <div className="grid h-9 grid-cols-2 rounded-control border border-line-strong bg-surface p-0.5">
                {(
                  [
                    ['board', LayoutGrid, 'Board'],
                    ['list', List, 'List'],
                  ] as const
                ).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={label}
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className={cx('grid w-9 place-items-center rounded-[9px] transition-colors', view === key ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
              <Button variant="primary" onClick={() => setCreating(visibleStages[0]?.key ?? 'lead')}>
                <Plus />
                New deal
              </Button>
            </>
          }
        />
      </div>

      {isLoading ? (
        <div className="mx-auto mt-6 grid w-full max-w-[1400px] grid-cols-6 gap-3 px-5 sm:px-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[300px] rounded-card" />
          ))}
        </div>
      ) : view === 'board' ? (
        <Board
          deals={items}
          hiddenStages={hiddenStages}
          onHide={hideStage}
          onShowAll={showAllStages}
          onOpen={(id) => setParams({ deal: id })}
          onAdd={(stage) => setCreating(stage)}
          onDropDelete={(deal) => remove.mutate(deal.id)}
        />
      ) : (
        <ListView deals={items} onOpen={(id) => setParams({ deal: id })} onDelete={setDeleting} />
      )}

      <DealForm open={creating !== null} onClose={() => setCreating(null)} defaults={{ stage: creating ?? 'lead' }} />
      <DealDrawer id={selected} onClose={() => setParams({})} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        title={`Delete ${deleting?.title ?? 'this deal'}?`}
        description="Its notes and files are removed too."
      />
    </div>
  )
}

// Board

function Board({
  deals,
  hiddenStages,
  onHide,
  onShowAll,
  onOpen,
  onAdd,
  onDropDelete,
}: {
  deals: Deal[]
  hiddenStages: DealStage[]
  onHide: (stage: DealStage) => void
  onShowAll: () => void
  onOpen: (id: string) => void
  onAdd: (stage: DealStage) => void
  onDropDelete: (deal: Deal) => void
}) {
  const client = useQueryClient()
  const [local, setLocal] = useState(deals)
  const [activeId, setActiveId] = useState<string | null>(null)
  useEffect(() => setLocal(deals), [deals])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const move = useApiMutation((input: { id: string; stage: DealStage; position: number }) => api(`/deals/${input.id}`, { method: 'PATCH', json: input }), ['deals', 'deal', 'overview', 'contact', 'company'])

  const columns = useMemo(
    () =>
      DEAL_STAGES.filter((s) => !hiddenStages.includes(s.key)).map((s) => ({
        ...s,
        deals: local.filter((d) => d.stage === s.key).sort((a, b) => a.position - b.position),
      })),
    [local, hiddenStages],
  )
  const byId = useMemo(() => new Map(local.map((d) => [d.id, d])), [local])

  function findStage(id: string): DealStage | undefined {
    if (DEAL_STAGES.some((s) => s.key === id)) return id as DealStage
    return byId.get(id)?.stage
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    if (String(over.id) === DELETE_ZONE_ID) return
    const from = findStage(String(active.id))
    const to = findStage(String(over.id))
    if (!from || !to || from === to) return
    // Move the card into the hovered column so the layout previews the drop.
    setLocal((prev) => {
      const target = prev.filter((d) => d.stage === to).sort((a, b) => a.position - b.position)
      const overIndex = target.findIndex((d) => d.id === over.id)
      const before = overIndex >= 0 ? target[overIndex] : undefined
      const after = overIndex >= 0 ? target[overIndex - 1] : target[target.length - 1]
      const position = positionBetween(after?.position, before?.position)
      return prev.map((d) => (d.id === active.id ? { ...d, stage: to, position } : d))
    })
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setActiveId(null)
    if (!over) {
      setLocal(deals)
      return
    }
    if (String(over.id) === DELETE_ZONE_ID) {
      setLocal(deals)
      const dragged = byId.get(String(active.id))
      // Dropping on the delete zone removes immediately; the list and drawer
      // delete buttons still ask for confirmation.
      if (dragged) onDropDelete(dragged)
      return
    }
    const dragged = byId.get(String(active.id))
    if (!dragged) return
    const stage = findStage(String(over.id)) ?? dragged.stage
    const column = local.filter((d) => d.stage === stage && d.id !== dragged.id).sort((a, b) => a.position - b.position)
    let position = dragged.position
    if (over.id !== active.id && over.id !== stage) {
      const overIndex = column.findIndex((d) => d.id === over.id)
      const original = deals.find((d) => d.id === dragged.id)
      const movingDown = original?.stage === stage && original.position < (column[overIndex]?.position ?? 0)
      const before = movingDown ? column[overIndex + 1] : column[overIndex]
      const after = movingDown ? column[overIndex] : column[overIndex - 1]
      position = positionBetween(after?.position, before?.position)
    } else if (over.id === stage) {
      position = positionBetween(column[column.length - 1]?.position, undefined)
    }
    const next = local.map((d) => (d.id === dragged.id ? { ...d, stage, position } : d))
    setLocal(next)
    client.setQueryData(['deals'], { items: next })
    const original = deals.find((d) => d.id === dragged.id)
    if (original && original.stage === stage && original.position === position) return
    move.mutate({ id: dragged.id, stage, position })
  }

  const active = activeId ? byId.get(activeId) : undefined

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (setActiveId(null), setLocal(deals))}>
      {hiddenStages.length > 0 && (
        <div className="mx-auto mt-4 flex w-full max-w-[1400px] justify-end px-5 sm:px-8">
          <button type="button" onClick={onShowAll} className="text-[12.5px] font-medium text-accent hover:underline">
            Show all columns ({hiddenStages.length} hidden)
          </button>
        </div>
      )}
      <div className={cx('scrollbar-thin flex-1 overflow-x-auto px-5 pb-6 sm:px-8', hiddenStages.length > 0 ? 'mt-2' : 'mt-6')}>
        {columns.length === 0 ? (
          <div className="mx-auto flex min-w-[1180px] max-w-[1400px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line py-20 text-center">
            <p className="text-[13.5px] font-medium">All columns are hidden</p>
            <button type="button" onClick={onShowAll} className="text-[12.5px] font-medium text-accent hover:underline">
              Show all columns
            </button>
          </div>
        ) : (
          <div className="mx-auto grid h-full min-w-[1320px] max-w-[1400px] gap-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr)) 180px` }}>
            {columns.map((col) => (
              <Column key={col.key} stage={col.key} label={col.label} deals={col.deals} onOpen={onOpen} onAdd={() => onAdd(col.key)} onHide={() => onHide(col.key)} />
            ))}
            <DeleteZone />
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
        {active && <DealCard deal={active} overlay />}
      </DragOverlay>
    </DndContext>
  )
}

function positionBetween(after: number | undefined, before: number | undefined): number {
  if (after === undefined && before === undefined) return 0
  if (after === undefined) return (before as number) - 1
  if (before === undefined) return after + 1
  return (after + before) / 2
}

function Column({ stage, label, deals, onOpen, onAdd, onHide }: { stage: DealStage; label: string; deals: Deal[]; onOpen: (id: string) => void; onAdd: () => void; onHide: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const total = deals.reduce((s, d) => s + d.value, 0)
  return (
    <section className="flex min-h-0 flex-col">
      <header className="group flex h-9 items-center gap-2 px-1">
        <span className={cx('round size-2', stageDot[stage])} />
        <h2 className="truncate text-[13px] font-semibold">{label}</h2>
        <span className="text-[12.5px] tabular-nums text-faint">{deals.length}</span>
        <span className="ml-auto text-[12.5px] tabular-nums text-muted">{moneyCompact(total)}</span>
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${label} column`}
          title="Hide column"
          className="grid size-6 place-items-center rounded-[7px] text-faint opacity-60 transition-colors hover:bg-surface-2 hover:text-danger focus-visible:bg-surface-2 focus-visible:text-danger focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div
        ref={setNodeRef}
        className={cx('flex min-h-[160px] flex-1 flex-col gap-2 rounded-card border border-dashed p-2 transition-colors', isOver ? 'border-accent/50 bg-accent-soft/40' : 'border-transparent bg-bg/70')}
      >
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((d) => (
            <SortableCard key={d.id} deal={d} onOpen={() => onOpen(d.id)} />
          ))}
        </SortableContext>
        <button
          type="button"
          onClick={onAdd}
          className="flex h-9 items-center justify-center gap-1.5 rounded-control text-[12.5px] text-faint transition-colors hover:bg-surface hover:text-fg"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>
    </section>
  )
}

function DeleteZone() {
  const { setNodeRef, isOver } = useDroppable({ id: DELETE_ZONE_ID })
  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex h-9 items-center gap-2 px-1">
        <span className="round size-2 bg-danger/70" />
        <h2 className="truncate text-[13px] font-semibold">Delete</h2>
        <Trash2 className="ml-auto size-3.5 text-danger/70" aria-hidden />
      </header>
      <div
        ref={setNodeRef}
        data-testid="deal-delete-zone"
        aria-label="Drop a deal here to delete it"
        className={cx(
          'flex min-h-[160px] flex-1 flex-col items-center justify-center gap-1.5 rounded-card border border-dashed p-3 text-center transition-colors',
          isOver ? 'border-danger/60 bg-danger-soft/60 text-danger' : 'border-danger/25 bg-bg/70 text-faint',
        )}
      >
        <span className={cx('mb-1 grid size-9 place-items-center rounded-full transition-colors', isOver ? 'bg-danger/15' : 'bg-surface-2')}>
          <Trash2 className="size-4" />
        </span>
        <p className="text-[12.5px] font-medium">{isOver ? 'Drop to delete' : 'Drag a card here'}</p>
        <p className="text-[11.5px]">to delete it</p>
      </div>
    </section>
  )
}

function SortableCard({ deal, onOpen }: { deal: Deal; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} {...attributes} {...listeners} className={cx(isDragging && 'opacity-30')}>
      <DealCard deal={deal} onOpen={onOpen} />
    </div>
  )
}

function DealCard({ deal, onOpen, overlay }: { deal: Deal; onOpen?: () => void; overlay?: boolean }) {
  return (
    <article
      onClick={onOpen}
      className={cx(
        'group relative cursor-grab rounded-[14px] border border-line bg-surface p-3 text-left shadow-card transition-[box-shadow,border-color] hover:border-line-strong active:cursor-grabbing',
        overlay && 'rotate-[1.5deg] cursor-grabbing shadow-pop',
      )}
    >
      <p className="line-clamp-2 text-[13.5px] font-medium leading-snug">{deal.title}</p>
      {deal.companyName && <p className="mt-0.5 truncate text-[12.5px] text-muted">{deal.companyName}</p>}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold tabular-nums">{money(deal.value)}</span>
        <div className="flex items-center gap-2">
          {deal.closeDate && (
            <span className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-faint">
              <Calendar className="size-3" />
              {shortDate(deal.closeDate)}
            </span>
          )}
          {deal.contactName && <Avatar name={deal.contactName} hue={deal.contactHue ?? 220} size={22} />}
        </div>
      </div>
    </article>
  )
}

// List

function ListView({ deals, onOpen, onDelete }: { deals: Deal[]; onOpen: (id: string) => void; onDelete: (deal: Deal) => void }) {
  const sorted = [...deals].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <div className="mx-auto mt-6 w-full max-w-[1400px] px-5 pb-8 sm:px-8">
      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full table-fixed text-left text-[13.5px]">
          <thead>
            <tr className="h-10 border-b border-line bg-bg/60 text-[12.5px] text-muted">
              <th className="w-[32%] px-4 font-medium">Deal</th>
              <th className="hidden w-[18%] px-4 font-medium md:table-cell">Company</th>
              <th className="w-[15%] px-4 font-medium">Stage</th>
              <th className="w-[13%] px-4 text-right font-medium">Value</th>
              <th className="hidden w-[14%] px-4 font-medium sm:table-cell">Close</th>
              <th className="w-10 px-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((d) => (
              <tr key={d.id} onClick={() => onOpen(d.id)} className="h-13 cursor-pointer transition-colors hover:bg-surface-2/60">
                <td className="truncate px-4 font-medium">{d.title}</td>
                <td className="hidden truncate px-4 text-muted md:table-cell">{d.companyName ?? <span className="text-faint">None</span>}</td>
                <td className="px-4">
                  <span className="inline-flex items-center gap-2 text-muted">
                    <span className={cx('round size-2', stageDot[d.stage])} />
                    {DEAL_STAGES.find((s) => s.key === d.stage)?.label}
                  </span>
                </td>
                <td className="px-4 text-right tabular-nums">{money(d.value)}</td>
                <td className="hidden px-4 tabular-nums text-muted sm:table-cell">{d.closeDate ? shortDate(d.closeDate) : ''}</td>
                <td className="px-2 text-right">
                  <button
                    type="button"
                    aria-label={`Delete ${d.title}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDelete(d)
                    }}
                    className="grid size-7 place-items-center rounded-[8px] text-faint transition-colors hover:bg-surface-2 hover:text-danger focus-visible:bg-surface-2 focus-visible:outline-none"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {deals.length === 0 && <EmptyState icon={<Handshake />} title="No deals yet" description="Deals move through stages from lead to won." />}
      </div>
    </div>
  )
}

// Drawer

function DealDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useDeal(id)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const setStage = useApiMutation((stage: DealStage) => api(`/deals/${id}`, { method: 'PATCH', json: { stage } }), ['deals', 'deal', 'overview', 'contact', 'company'])
  const remove = useApiMutation(() => api(`/deals/${id}`, { method: 'DELETE' }), ['deals', 'overview', 'contact', 'company'], {
    onSuccess: () => {
      setDeleting(false)
      onClose()
    },
  })
  const deal = data?.deal

  return (
    <>
      <Drawer
        open={Boolean(id)}
        onClose={onClose}
        title={deal?.title ?? 'Deal'}
        header={
          deal && (
            <div className="flex items-center gap-2">
              <Badge tone={deal.stage === 'won' ? 'success' : deal.stage === 'lost' ? 'danger' : 'accent'}>{DEAL_STAGES.find((s) => s.key === deal.stage)?.label}</Badge>
              <span className="text-[13px] tabular-nums text-muted">{money(deal.value)}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit deal" onClick={() => setEditing(true)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete deal" onClick={() => setDeleting(true)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          )
        }
      >
        {deal && (
          <div className="flex flex-col gap-6 p-5">
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight">{deal.title}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px]">
                {deal.companyName && (
                  <Link to={`/companies/${deal.companyId}`} className="inline-flex items-center gap-2 hover:underline">
                    <CompanyMark name={deal.companyName} hue={220} size={22} />
                    {deal.companyName}
                  </Link>
                )}
                {deal.contactName && (
                  <Link to={`/contacts/${deal.contactId}`} className="inline-flex items-center gap-2 hover:underline">
                    <Avatar name={deal.contactName} hue={deal.contactHue ?? 220} size={22} />
                    {deal.contactName}
                  </Link>
                )}
                {deal.closeDate && (
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <Calendar className="size-3.5" />
                    {shortDate(deal.closeDate)}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-6 gap-1 rounded-control bg-bg p-1">
              {DEAL_STAGES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStage.mutate(s.key)}
                  className={cx(
                    'h-8 truncate rounded-[9px] px-1 text-[12px] font-medium transition-colors',
                    deal.stage === s.key ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <NoteComposer dealId={deal.id} />
            <div>
              <h3 className="text-[13px] font-semibold">Activity</h3>
              <ActivityFeed items={data.activities} />
            </div>
            <FilesPanel files={data.files} target={{ dealId: deal.id }} />
          </div>
        )}
      </Drawer>
      <DealForm open={editing} initial={deal} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
        title="Delete this deal?"
        description="Its notes and files are removed too."
      />
    </>
  )
}
