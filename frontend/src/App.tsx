import { Routes, Route } from 'react-router-dom'
import WelcomingPage from './pages/welcomingPage/welcomingPage'
import Landing_Page from './pages/landingPage/landingPage'
import MeetRoomPage from './pages/meetRoomPage/meetRoomPage'
import LoginPage from './pages/loginPage/loginPage'
import RequireAuth from './components/requireAuth'

export function App() {
  return (
    <Routes>
      <Route path='/' element={<Landing_Page />} />
      <Route path='/login' element={<LoginPage />} />
      <Route path='/welcome' element={<RequireAuth><WelcomingPage /></RequireAuth>} />
      <Route path='/meet/:roomCode' element={<RequireAuth><MeetRoomPage /></RequireAuth>} />
    </Routes>
  )
}

export default App
