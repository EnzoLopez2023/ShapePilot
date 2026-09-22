// The filters, as Bambu Handy lays them out: a search, then a row of
// drop-down pills. A pill that is filtering says what it filters to and takes
// the selected wash, so the state of the page is readable from the bar alone.
//
// It sticks to the top of the scroll so the filters stay in reach down a
// catalogue of two hundred reels.
import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Box, Button, IconButton, InputAdornment, ListItemIcon, ListItemText, Menu, MenuItem, Paper,
  TextField, Tooltip,
} from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import SellOutlinedIcon from '@mui/icons-material/SellOutlined'
import type { FilamentLine } from '../../../../lib/contracts/bambuFilaments.ts'
import { STATUS_LABEL } from '../model/shelf.ts'
import type { StatusFilter } from '../model/shelf.ts'

export interface FilterBarProps {
  search: string
  onSearch: (next: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  lines: readonly { id: string; line: FilamentLine }[]
  line: string | null
  onLine: (next: string | null) => void
  status: StatusFilter
  onStatus: (next: StatusFilter) => void
  /** Which status filters have anything to go on; AMS and usage are admin-only. */
  statuses: readonly StatusFilter[]
  showDiscontinued: boolean
  onShowDiscontinued: (next: boolean) => void
  labelCount: number
  onLabels: () => void
  onPrices: () => void
}

const actionSx = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  minWidth: { xs: 40, sm: 64 },
  '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 }, ml: { xs: 0, sm: -0.5 } },
} as const

function Pill({
  label, active, onClick, open, id,
}: { label: string; active: boolean; onClick: (el: HTMLElement) => void; open: boolean; id: string }) {
  return (
    <Button
      id={id}
      size="small"
      variant="outlined"
      color="inherit"
      endIcon={<ExpandMoreRoundedIcon />}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={event => onClick(event.currentTarget)}
      sx={{
        flexShrink: 0,
        borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? 'action.selected' : 'transparent',
        color: active ? 'primary.main' : 'text.primary',
        fontWeight: active ? 650 : 550,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Button>
  )
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <MenuItem selected={selected} onClick={onClick}>
      <ListItemIcon sx={{ visibility: selected ? 'visible' : 'hidden' }}>
        <CheckRoundedIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText>{children}</ListItemText>
    </MenuItem>
  )
}

export default function FilterBar({
  search, onSearch, searchRef, lines, line, onLine, status, onStatus, statuses,
  showDiscontinued, onShowDiscontinued, labelCount, onLabels, onPrices,
}: FilterBarProps) {
  const [menu, setMenu] = useState<{ which: 'line' | 'status'; anchor: HTMLElement } | null>(null)
  const close = () => setMenu(null)
  const lineLabel = line ? lines.find(entry => entry.id === line)?.line.label ?? 'Type' : 'Type'

  return (
    <Paper
      sx={{
        // Negative by the scroll area's own top padding, so the bar sits flush
        // with the top edge instead of leaving a strip for the reels to show
        // through above it.
        position: 'sticky',
        top: { xs: -12, md: 'calc(-16px - var(--sp-safe-top))' },
        zIndex: 2,
        p: 1.25,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1,
      }}
    >
      <TextField
        size="small"
        placeholder="Search colours or codes"
        value={search}
        inputRef={searchRef}
        onChange={event => onSearch(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') onSearch('') }}
        sx={{ flex: { xs: '1 1 100%', md: '1 1 240px' }, minWidth: 0 }}
        slotProps={{
          htmlInput: { 'aria-label': 'Search colours' },
          input: {
            startAdornment: (
              <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment>
            ),
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton size="small" edge="end" aria-label="Clear search" onClick={() => onSearch('')}>
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          },
        }}
      />

      {/* The pills scroll sideways on a phone rather than wrapping into a
          second and third row that would eat the screen they filter. */}
      <Box
        sx={{
          display: 'flex', gap: 1, alignItems: 'center', minWidth: 0,
          flex: { xs: '1 1 100%', md: '0 1 auto' },
          overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
          mx: { xs: -1.25, md: 0 }, px: { xs: 1.25, md: 0 },
        }}
      >
        <Pill
          id="filter-line"
          label={lineLabel}
          active={line !== null}
          open={menu?.which === 'line'}
          onClick={anchor => setMenu({ which: 'line', anchor })}
        />
        <Pill
          id="filter-status"
          label={status === 'all' ? 'Status' : STATUS_LABEL[status]}
          active={status !== 'all'}
          open={menu?.which === 'status'}
          onClick={anchor => setMenu({ which: 'status', anchor })}
        />
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          aria-pressed={showDiscontinued}
          onClick={() => onShowDiscontinued(!showDiscontinued)}
          startIcon={showDiscontinued ? <CheckRoundedIcon /> : undefined}
          sx={{
            flexShrink: 0, whiteSpace: 'nowrap',
            borderColor: showDiscontinued ? 'primary.main' : 'divider',
            bgcolor: showDiscontinued ? 'action.selected' : 'transparent',
            color: showDiscontinued ? 'primary.main' : 'text.primary',
            fontWeight: showDiscontinued ? 650 : 550,
          }}
        >
          Discontinued
        </Button>

        <Box sx={{ flex: 1, minWidth: 8 }} />

        {/* Words at a desk, icons on a phone: the pills are what a thumb
            is here for, and these two are occasional. One control each, named
            the same at every width. */}
        <Tooltip title="What a kilogram of each line costs, for costing your prints">
          <Button
            size="small"
            color="inherit"
            aria-label="Prices"
            startIcon={<SellOutlinedIcon />}
            onClick={onPrices}
            sx={actionSx}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Prices</Box>
          </Button>
        </Tooltip>
        <Tooltip title="A sheet for the label printer, one label per colour shown">
          <span style={{ flexShrink: 0 }}>
            <Button
              size="small"
              color="inherit"
              aria-label={`Label sheet (${labelCount})`}
              startIcon={<DownloadRoundedIcon />}
              onClick={onLabels}
              disabled={labelCount === 0}
              sx={actionSx}
            >
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                Label sheet ({labelCount})
              </Box>
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Menu
        anchorEl={menu?.anchor}
        open={menu?.which === 'line'}
        onClose={close}
        slotProps={{ list: { 'aria-labelledby': 'filter-line', dense: true } }}
      >
        <Option selected={line === null} onClick={() => { onLine(null); close() }}>All types</Option>
        {lines.map(entry => (
          <Option key={entry.id} selected={line === entry.id} onClick={() => { onLine(entry.id); close() }}>
            {entry.line.label}
          </Option>
        ))}
      </Menu>
      <Menu
        anchorEl={menu?.anchor}
        open={menu?.which === 'status'}
        onClose={close}
        slotProps={{ list: { 'aria-labelledby': 'filter-status', dense: true } }}
      >
        {statuses.map(value => (
          <Option key={value} selected={status === value} onClick={() => { onStatus(value); close() }}>
            {STATUS_LABEL[value]}
          </Option>
        ))}
      </Menu>
    </Paper>
  )
}
