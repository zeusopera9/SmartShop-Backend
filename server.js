const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Configure MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error('Database connection error:', err);
    return;
  }
  console.log('Connected to MySQL database');
});

// Mapping function to determine the correct table name
const getTableName = (gender, footwearType) => {
  const genderMapping = {
    m: 'm',
    f: 'w',
    k: 'k'
  };

  const typeMapping = {
    m: {
      sport_shoes: 'sport_shoes',
      flip_flops: 'flip_flops',
      sandals: 'sandals'
    },
    f: {
      sport_shoes: 'sport_shoes',
      flats: 'flats',
      heels: 'heels'
    },
    k: {
      sport_shoes: 'sport_shoes',
      flip_flops: 'flip_flops',
      school_shoes: 'school_shoes'
    }
  };

  if (genderMapping[gender] && typeMapping[gender][footwearType]) {
    return `${genderMapping[gender]}_product_details_${typeMapping[gender][footwearType]}_processed`;
  } else {
    return null;
  }
};

// Endpoint to receive text input and process with Gemini API
app.post('/analyze', async (req, res) => {
    const userInput = req.body.text;

    if (!userInput) {
      return res.status(400).json({ error: 'No text provided' });
    }

    try {
      // Send the input to the Gemini API
      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [{ parts: [{ text: userInput }] }]
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      // Extract analysis data from the response
      const analysisData = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsedData = JSON.parse(analysisData.match(/{.*}/s)?.[0]);
      console.log(parsedData);

      // Extract fields from the parsed data
      const gender = parsedData.gender?.toLowerCase();             // 'm', 'f', or 'k'
      const footwearType = parsedData.footwear_type?.toLowerCase(); // E.g., 'sport_shoes'
      const color = parsedData.color?.toLowerCase();               // E.g., 'red', 'blue'
      const subtype = parsedData.subtype?.toLowerCase();           // Subtype of footwear, if available
      let minPrice = parsedData.price_range?.min;                  // Minimum price
      let maxPrice = parsedData.price_range?.max;                  // Maximum price

      // Assign default values if minPrice or maxPrice is null or undefined
      minPrice = minPrice !== null && minPrice !== undefined ? minPrice : 0;
      maxPrice = maxPrice !== null && maxPrice !== undefined ? maxPrice : 50000;

      // Get the table name based on gender and footwear type
      const tableName = getTableName(gender, footwearType);

      if (!tableName) {
        return res.status(400).json({ error: 'Invalid gender or footwear type provided' });
      }

      // Construct the SQL query with filters for color and price range
      let query = `SELECT * FROM ${tableName} WHERE 1=1`;
      const values = [];

      if (color) {
        query += ` AND Description REGEXP ?`;
        values.push(`(^|\\s)${color}(\\s|$)`);
      }

      // Handle price range filtering with conditions for min and max values
      query += ` AND Price >= ? AND Price <= ?`;
      values.push(minPrice, maxPrice);

      // Check if the table has a Type column and add the subtype filter if it does
      db.query(`SHOW COLUMNS FROM ${tableName} LIKE 'Type'`, (err, columns) => {
        if (err) {
          console.error('Error checking Type column existence:', err);
          return res.status(500).json({ error: 'Database query failed' });
        }

        if (columns.length && subtype) { // If Type column exists and subtype is provided
          query += ` AND Type LIKE ?`;
          values.push(`%${subtype}%`);
        }

        // Add the ORDER BY clause to sort by Price in ascending order
        query += ` ORDER BY Rating DESC`;

        // Execute the final query with all filters applied
        db.query(query, values, (err, results) => {
          if (err) {
            console.error('Error executing query:', err);
            return res.status(500).json({ error: 'Database query failed' });
          }
          res.json(results);
        });
      });

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      res.status(500).json({ error: 'Gemini API call failed' });
    }
});

app.post('/top-selling', (req, res) => {
  // Retrieve the gender value from the request body
  const gender = req.body.gender?.toLowerCase();

  // Validate the gender input
  if (!['m', 'f'].includes(gender)) {
    return res.status(400).json({ error: 'Invalid gender provided. Use "m" or "f".' });
  }

  // Determine the table name based on the gender
  const tableName = gender === 'm'
    ? 'm_product_details_sport_shoes_processed'
    : 'w_product_details_sport_shoes_processed';

  // Construct the SQL query to fetch the top 5 products by highest "Ratings Count"
  const query = `
    SELECT * FROM ${tableName}
    ORDER BY \`Ratings Count\` DESC
    LIMIT 5
  `;

  db.query(query, (err, results) => {
    if(err) {
      console.error('Error Executing Query: ', err);
      return res.status(500).json({error: 'Database Query Failed'});
    }
    res.json(results);
  })
})

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
