// What the invoices say, for a person to check before anything is saved.
//
// The reader proposes; this is where a person disposes. Each invoice shows its
// filament as it will be logged -- colour, form, how many, what each roll cost
// once tax and the order's credits are shared out -- and whether its lines add
// up to what the invoice says was paid. A line the reader could not match is
// matched here, by hand, and an invoice that is already logged, unreadable or
// still has an unmatched line is left out of the save.
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  Stack, Typography,
} from '@mui/material'
import { filamentByKey } from '../../../../lib/contracts/bambuFilaments.ts'
import { landedCosts, orderTotal, totalsAgree } from '../../../../lib/contracts/filamentOrders.ts'
import { colorLabel } from '../model/usage.ts'
import { formatMoney } from '../model/cost.ts'
import { SpoolArt } from './SpoolArt.tsx'
import CatalogColorField from './CatalogColorField.tsx'
import { saveable } from '../model/invoiceProposal.ts'
import type { InvoiceProposal } from '../model/invoiceProposal.ts'

export interface InvoiceReviewDialogProps {
  proposals: InvoiceProposal[] | null
  busy: boolean
  onChange: (next: InvoiceProposal[]) => void
  onClose: () => void
  onSave: () => void
}

export default function InvoiceReviewDialog({
  proposals, busy, onChange, onClose, onSave,
}: InvoiceReviewDialogProps) {
  const chosen = (proposals ?? []).filter(proposal => proposal.include && saveable(proposal))
  const rolls = chosen.reduce((sum, proposal) => sum + proposal.parsed!.order.lines
    .reduce((n, line) => n + (line.key ? line.quantity : 0), 0), 0)

  const update = (index: number, next: InvoiceProposal) =>
    onChange(proposals!.map((entry, at) => (at === index ? next : entry)))

  return (
    <Dialog
      open={proposals !== null}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="invoice-review-title"
    >
      <DialogTitle id="invoice-review-title">Check before saving</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {(proposals ?? []).map((proposal, index) => {
            const order = proposal.parsed?.order
            const costs = order ? landedCosts(order) : []
            const ok = saveable(proposal)
            return (
              <Box
                key={`${proposal.file}-${index}`}
                component="section"
                aria-label={order?.orderNumber ? `Order ${order.orderNumber}` : proposal.file}
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '14px', p: 1.5 }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <FormControlLabel
                    sx={{ mr: 'auto' }}
                    control={(
                      <Checkbox
                        checked={proposal.include && ok}
                        disabled={!ok || busy}
                        onChange={event => update(index, { ...proposal, include: event.target.checked })}
                      />
                    )}
                    label={(
                      <Typography variant="body2" sx={{ fontWeight: 650 }}>
                        {order ? `${order.orderedAt} · ${order.orderNumber}` : proposal.file}
                      </Typography>
                    )}
                  />
                  {order && (
                    <Typography
                      variant="body2"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        color: totalsAgree(order) ? 'text.secondary' : 'warning.main',
                      }}
                    >
                      {order.grandTotal === null ? 'No total on the invoice'
                        : totalsAgree(order) ? `${formatMoney(order.grandTotal, order.currency)} · adds up`
                          : `Lines add to ${formatMoney(orderTotal(order), order.currency)}, invoice says ${formatMoney(order.grandTotal, order.currency)}`}
                    </Typography>
                  )}
                </Stack>

                {proposal.error && <Alert severity="error" sx={{ mt: 1 }}>{proposal.error}</Alert>}
                {proposal.duplicate && (
                  <Alert severity="info" sx={{ mt: 1 }}>Already logged, so it is left out.</Alert>
                )}

                {order && (
                  <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }} spacing={0.75}>
                    {order.lines.map((line, at) => {
                      if (!line.key && !line.unmatched) {
                        return (
                          <Typography key={at} component="li" variant="body2" color="text.secondary">
                            {line.description} · not filament
                          </Typography>
                        )
                      }
                      const color = line.key ? filamentByKey(line.key) : undefined
                      const each = costs[at] === null ? null : costs[at]! / line.quantity
                      return (
                        <Stack key={at} component="li" direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
                          <SpoolArt hexes={color?.hexes ?? ['#8A9096']} variant={line.variant ?? 'spool'} size={30} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            {line.unmatched ? (
                              <Stack spacing={0.5}>
                                <Typography variant="body2" sx={{ color: 'warning.main' }}>
                                  Not matched: {line.description}
                                </Typography>
                                <CatalogColorField
                                  value={line.key}
                                  label="This is…"
                                  ariaLabel={`What “${line.description}” is`}
                                  error={!line.key}
                                  onChange={key => update(index, {
                                    ...proposal,
                                    parsed: {
                                      ...proposal.parsed!,
                                      order: {
                                        ...order,
                                        lines: order.lines.map((entry, n) => (n === at ? { ...entry, key } : entry)),
                                      },
                                    },
                                  })}
                                />
                              </Stack>
                            ) : (
                              <Typography variant="body2">
                                {colorLabel(line.key!)}
                                <Box component="span" sx={{ color: 'text.secondary' }}>
                                  {' '}· {line.variant === 'refill' ? 'Refill' : 'With spool'}
                                  {line.gramsPerUnit !== 1000 && ` · ${line.gramsPerUnit} g`}
                                </Box>
                              </Typography>
                            )}
                          </Box>
                          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {line.quantity} × {each === null ? '—' : formatMoney(each, order.currency)}
                          </Typography>
                        </Stack>
                      )
                    })}
                  </Stack>
                )}

                {proposal.parsed && proposal.parsed.warnings.length > 0 && (
                  <Stack component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                    {proposal.parsed.warnings.map(warning => (
                      <Typography key={warning} component="li" variant="body2" sx={{ color: 'warning.main' }}>
                        {warning}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>
            )
          })}
          <Typography variant="body2" color="text.secondary">
            Each roll is priced at what it actually cost: its price after discounts, its share of
            any store credit, order discount and shipping, and its own tax.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={onSave} disabled={busy || chosen.length === 0}>
          {chosen.length === 0 ? 'Nothing to save'
            : `Save ${chosen.length} ${chosen.length === 1 ? 'order' : 'orders'} · ${rolls} ${rolls === 1 ? 'roll' : 'rolls'}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
