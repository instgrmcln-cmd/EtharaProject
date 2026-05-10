const router = require('express').Router()
const CryptoJS = require('crypto-js')
const jwt = require('jsonwebtoken')
const User = require('../models/userModel')

// REGISTER
router.post('/register', async (req, res) => {
    const newUser = new User({
        email: req.body.email,
        fullName: req.body.fullName,
        password: CryptoJS.AES.encrypt(req.body.password, process.env.PASS_SEC).toString()
    })

    try {
        const savedUser = await newUser.save()
        const accessToken = jwt.sign({
            _id: savedUser._id,
            isAdmin: savedUser.isAdmin
        }, process.env.JWT_SEC)
        const { password, ...others } = savedUser._doc
        res.status(201).json({ ...others, accessToken })
    } catch (err) {
        return res.status(403).json(err)
    }
})

// LOGIN
router.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({email: req.body.email})

        const hashedPassword = CryptoJS.AES.decrypt(user.password, process.env.PASS_SEC)
        const OriginalPassword = hashedPassword.toString(CryptoJS.enc.Utf8)

        if (OriginalPassword != req.body.password) {
            return res.status(401).json({ message: 'Username or password is incorrect.'})
        }

        const accessToken = jwt.sign({
            _id: user._id,
            isAdmin: user.isAdmin
        }, process.env.JWT_SEC)
        const { password, ...others } = user._doc

        res.status(200).json({ ...others, accessToken })
    } catch (err) {
        return res.status(403).json(err)
    }
})

router.get('/', async (req, res) => {
  try {
    const users = await User.find({}, {
      email: 1,
      fullName: 1,
      isAdmin: 1,
      _id: 1
    })
    
    res.status(200).json(users)
  } catch (err) {
    return res.status(500).json({ message: err.message })
  }
})

module.exports = router