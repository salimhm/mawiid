import { useNavigate } from 'react-router-dom'
import { CreateIcon } from '../utils/icons'

export default function CreateButton()
{
    const navigate = useNavigate()

    const handleCreateClick = () => {
        navigate('/welcome?creator=1', { state: { isCreator: true } })
    }

    return (
        <button
            type='button'
            onClick={handleCreateClick}
            className='w-full border border-[#FFFFFF4D] bg-primary-white hover:bg-primary-white/80 hover:scale-105 cursor-pointer px-5 sm:px-8 py-3 rounded-full flex justify-center items-center gap-2 sm:gap-[11px] transition-all duration-200'
        >
            {CreateIcon()}
            <span className='text-primary-black font-montserrat font-bold text-base sm:text-lg lg:text-[20px] whitespace-nowrap flex items-center gap-2'>
                Create Mawiid
            </span>
        </button>
    )
}