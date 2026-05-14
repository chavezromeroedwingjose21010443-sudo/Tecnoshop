exports.handler = async (event) => {
  try {

    // Buscar término
    const query =
      event.queryStringParameters?.q || "laptop";

    // TOKEN EBAY
    const tokenResponse = await fetch(
      "https://api.ebay.com/identity/v1/oauth2/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          Authorization:
            "Basic " +
            Buffer.from(
              process.env.EBAY_CLIENT_ID +
                ":" +
                process.env.EBAY_CLIENT_SECRET
            ).toString("base64"),
        },

        body:
          "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
      }
    );

    const tokenData =
      await tokenResponse.json();

    const accessToken =
      tokenData.access_token;

    // BUSCAR SOLO SURPLUSSPECTRA
    const response = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(
        query
      )}&limit=50&filter=sellers:{surplusspectra}`,
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();

    return {
      statusCode: 200,

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(data),
    };

  } catch (error) {

    return {
      statusCode: 500,

      body: JSON.stringify({
        error: error.message,
      }),
    };
  }
};