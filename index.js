const express = require('express')
const mongoose = require('mongoose')
const dotenv = require('dotenv')
const cors = require('cors')
const path = require('path')
const app = express()

const userRoutes = require('./routes/userRoutes')
const projectRoutes = require('./routes/projectRoutes')
const taskRoutes = require('./routes/taskRoutes')

dotenv.config()

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Database connected.'))
    .catch(err => console.error(err))

app.use(cors())
app.use(express.json())

app.use('/api/users/', userRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/tasks', taskRoutes)

app.use(express.static(path.join(__dirname, '/client/build')))
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '/client/build', 'index.html'))
})

app.listen(process.env.PORT || 5000, () => {
    console.log('Server is running...')
})