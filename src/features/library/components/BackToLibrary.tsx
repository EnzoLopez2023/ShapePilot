import { Button } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { Link } from 'react-router-dom'

export function BackToLibrary() {
  return (
    <Button component={Link} to="/library" size="small" startIcon={<ArrowBackRoundedIcon />} sx={{ alignSelf: 'flex-start' }}>
      Library
    </Button>
  )
}
