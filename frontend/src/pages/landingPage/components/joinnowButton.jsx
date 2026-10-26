export default function JoinnowButton()
{
    const handleClick = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <button 
            onClick={handleClick}
            className="flex justify-center items-center w-full max-w-[220px] h-[48px] bg-primary-white rounded-[10px] text-primary-black font-montserrat font-[700] text-base sm:text-[18px] cursor-pointer hover:bg-primary-black hover:text-primary-white hover:border hover:border-primary-white transition duration-300"
        >
            Join Now
        </button>
    )
}