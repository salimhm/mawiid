import { useNavigate } from 'react-router-dom';
 
export default function CreatemeetButton()
{
    const navigate = useNavigate();

    return (
        <button 
            onClick={() => navigate('/welcome?creator=1', { state: { isCreator: true } })}
            className="flex justify-center items-center w-full max-w-[220px] h-[48px] bg-primary-black rounded-[10px] text-primary-white font-montserrat font-[700] text-base sm:text-[18px] cursor-pointer hover:bg-primary-white hover:text-primary-black border border-primary-white transition duration-300"
        >
            Create a Meet
        </button>
    )
}