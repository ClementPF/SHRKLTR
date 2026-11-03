package calc.security;

import calc.DTO.ProviderUserInfoDTO;
import calc.exception.APIException;
import calc.property.GoogleProperties;
import com.auth0.jwk.*;
import com.auth0.jwt.JWT;
import com.google.api.client.auth.oauth2.TokenResponse;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.HttpTransport;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.JsonFactory;
import com.google.api.client.json.jackson2.JacksonFactory;
import org.bouncycastle.asn1.pkcs.PrivateKeyInfo;
import org.bouncycastle.crypto.tls.SignatureAlgorithm;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.FileReader;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.PrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Arrays;
import java.util.Collection;
import java.util.Date;


import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.Claim;
import com.auth0.jwt.interfaces.DecodedJWT;

/**
 * Created by clementperez on 15/05/18.
 */
@Component
public class AppleTokenVerifier {

    private static final Logger logger = LoggerFactory.getLogger(AppleTokenVerifier.class);

    private static final HttpTransport transport = new NetHttpTransport();
    private static final JsonFactory jsonFactory = new JacksonFactory();

    public static ProviderUserInfoDTO verify(String idTokenString) throws JWTVerificationException {

        DecodedJWT decoded = JWT.decode(idTokenString);

        String url = "https://appleid.apple.com/auth/keys";
        JwkProvider provider = new UrlJwkProvider(url);
        String keyId = decoded.getKeyId();

        Jwk jwk = null;
        try {
            jwk = provider.get(keyId);
        } catch (JwkException e) {
            e.printStackTrace();
        }

        RSAPublicKey publicKey = null;
        try {
            publicKey = (RSAPublicKey) jwk.getPublicKey();
        } catch (InvalidPublicKeyException e) {
            e.printStackTrace();
        }
        // The reason I need the conversion is to use java-jwt library to be able to do this:
        Algorithm algorithm = Algorithm.RSA256(publicKey, null);
        JWTVerifier verifier = JWT.require(algorithm)
                .withIssuer("https://appleid.apple.com")
                .build();

        DecodedJWT jwt = verifier.verify(idTokenString);

        Claim email = jwt.getClaim("email");
        Claim userId = jwt.getClaim("sub");

        return new ProviderUserInfoDTO(userId.asString(),email.asString().split("@")[0],email.asString());
    }

    private static Boolean verifyToken(String idTokenString){

       return false;
    }
}