import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      console.error('❌ MONGODB_URI не найден в .env');
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 5,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
    });

    console.log('✅ MongoDB успешно подключена');
  } catch (error) {
    console.error('❌ Ошибка подключения к MongoDB:', error.message);
    // НеExiting, чтобы сервер мог запуститься без БД (если нужно)
    // Или выбросить ошибку, чтобы она была поймана выше
    throw error;
  }
};

mongoose.connection.on('error', (err) => {
  console.error('MongoDB ошибка соединения:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB отключена');
});

export default connectDB;