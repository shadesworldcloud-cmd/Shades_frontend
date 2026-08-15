import React from 'react'
import './Header.css'
import HEADER_IMAGE from '../Header/header_img.png'
const Header = () => {
  return (
    <div className='header' >
      <img src= {HEADER_IMAGE} alt="" style={{backgroundRepeat: "no-repeat", width:"100%"}}/>
        <div className="header-contents">
            <h2>Order your favourate here</h2>
            <p>Choose from a diverse manu featuring a delectable array of dishes</p>
            <button>View Menu</button>
        </div>

    </div>
  )
}

export default Header