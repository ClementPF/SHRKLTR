package calc.security;

import calc.exception.APIException;
import calc.property.GoogleProperties;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.HttpTransport;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.JsonFactory;
import com.google.api.client.json.jackson2.JacksonFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;

/**
 * Created by clementperez on 15/05/18.
 */
@Component
public class GoogleTokenVerifier {

    private static final Logger logger = LoggerFactory.getLogger(GoogleTokenVerifier.class);

    @Autowired
    private static GoogleProperties googleProperties;

    private static final HttpTransport transport = new NetHttpTransport();
    private static final JsonFactory jsonFactory = new JacksonFactory();

    public GoogleIdToken.Payload verify(String idTokenString)
            throws GeneralSecurityException, IOException, APIException {
        return GoogleTokenVerifier.verifyToken(idTokenString);
    }

    private static GoogleIdToken.Payload verifyToken(String idTokenString)
            throws GeneralSecurityException, IOException, APIException {
/*
        #autowired doesn't autowire, maybe because not compatible with @component or static
        Collection audience = Arrays.asList(
                googleProperties.getIosClientId(),
                googleProperties.getAndroidClientId(),
                googleProperties.getIosStandaloneClientId(),
                googleProperties.getAndroidStandaloneClientId());*/

        Collection audience = Arrays.asList(
                "975514203843-jriblf35irfbh0e8e49ojeq2q4egtc98.apps.googleusercontent.com", //getIosClientId
                "975514203843-4bkrrov84hiepp4a6r8ngci9j1o8lnhk.apps.googleusercontent.com", //getAndroidClientId
                "975514203843-4iitkt007snetchd63d8v6e96vu7qnle.apps.googleusercontent.com",
                "975514203843-kqho0mtodfj50penbqrt1voq9hs34j57.apps.googleusercontent.com",//getIosStandaloneClientId
                "975514203843-28qehmdnj49oefjubbg99o1n68ahj3f7.apps.googleusercontent.com", //firebase
                "975514203843-kqho0mtodfj50penbqrt1voq9hs34j57.apps.googleusercontent.com", //firebase
                "975514203843-orbnpufagngsecqdg13hkm8rloleakre.apps.googleusercontent.com" //firebase
               );

        final GoogleIdTokenVerifier verifier = new GoogleIdTokenVerifier.
                Builder(transport, jsonFactory)
                .setIssuers(Arrays.asList("https://accounts.google.com", "accounts.google.com"))
                .setAudience(audience)
                .build();


        System.out.println("validating:" + idTokenString);

        GoogleIdToken idToken = null;
        try {
            idToken = verifier.verify(idTokenString);
            System.out.println("token validated:" + idTokenString);
        } catch (IllegalArgumentException e){

            e.printStackTrace();
            throw new APIException(HttpStatus.UNAUTHORIZED, "token is invalid");
            // means token was not valid and idToken
            // will be null
        }

        if (idToken == null) {
            System.out.println("validating failed: without exception ");
            throw new APIException(HttpStatus.UNAUTHORIZED, "idToken is invalid");
        }

        return idToken.getPayload();
    }
}