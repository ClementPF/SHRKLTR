package calc.service;

import calc.DTO.*;
import calc.entity.User;
import calc.exception.APIException;
import calc.property.FacebookProperties;
import calc.property.GoogleProperties;
import calc.property.JwtProperties;
import calc.repository.UserRepository;
import calc.security.AppleTokenVerifier;
import calc.security.GoogleTokenVerifier;
import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.Claim;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;


import javax.annotation.PostConstruct;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.text.Normalizer;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 *
 * @author danny
 */
@Service
public class AuthService {
    private static final Logger logger = LoggerFactory.getLogger(AuthService.class);
    
    @Autowired
    private JwtProperties jwtProperties;
    @Autowired
    private JWTVerifier jwtVerifier;
    @Autowired
    private FacebookProperties facebookProperties;
    @Autowired
    private GoogleProperties googleProperties;
    
    @Autowired
    private UserRepository userRepository;
    
    @Autowired
    private Algorithm algorithm;
    @Autowired
    private ObjectMapper objectMapper;
    
    private Long tokenRefreshExpirationMillis; //1y
    private Long tokenExpirationMillis;
    private RestTemplate restTemplate;

    @PostConstruct
    private void setUp() {
        tokenExpirationMillis = jwtProperties.getTokenExpirationMinutes() * 60 * 1000;
        tokenRefreshExpirationMillis = jwtProperties.getTokenRefreshExpirationMinutes() * 60 * 1000; // 1y
        restTemplate = new RestTemplate();
    }

    public TokenDTO getTokenFromProvider(TokenRequestDTO tokenRequest) {
        logger.debug("getTokenFromProvider :" + tokenRequest.getProviderAccessToken() );
        if(tokenRequest.getTokenProvider().equalsIgnoreCase("facebook")){
            return getTokenFromFB(tokenRequest);
        }else if(tokenRequest.getTokenProvider().equalsIgnoreCase("google")){
            return getTokenFromGoogle(tokenRequest);
        }else if(tokenRequest.getTokenProvider().equalsIgnoreCase("apple")){
            return getTokenFromAppleSignIn(tokenRequest);
        }
        return null;
    }

    protected TokenDTO getTokenFromFB(TokenRequestDTO tokenRequest) {
        String requestURL = facebookProperties.getGraphApiUri() + "/me?fields=" + 
            facebookProperties.getUserFields() + "&access_token=" + tokenRequest.getProviderAccessToken();

        logger.debug("get TOKEN :" + tokenRequest.getProviderAccessToken() );

        try {
            logger.debug("Making graph API request for user info");
            ResponseEntity<ProviderUserInfoDTO> response = restTemplate.getForEntity(requestURL, ProviderUserInfoDTO.class);
            logger.debug("Received 200 from graph API");

            ProviderUserInfoDTO userInfo = response.getBody();
            userInfo.setProvider(tokenRequest.getTokenProvider());

            User user = userRepository.findByExternalId(userInfo.getId());
            if (user == null) {
                createUserFromExternalProvider(userInfo);
            }else{
                updateFromExternalProvider(user, userInfo);
            }

            return createTokenPair(userInfo);
        } catch (HttpStatusCodeException hsce) {
            // Received HTTP status != 200 from Graph API
            logger.warn("Received bad HTTP status code from Graph API. Exception message: {}", hsce.getMessage());
            try {
                // attempt to deserialize error body
                FacebookErrorDTO error = objectMapper.readValue(hsce.getResponseBodyAsString(), FacebookErrorDTO.class);
                throw new APIException(hsce.getStatusCode(), error.getError().getMessage(), hsce);
            } catch (IOException ioe) {
                logger.error("Failed to deserialize Graph API error response", ioe);
                throw new APIException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to reach Facebook Graph API");
            }
        } catch (ResourceAccessException rae) {
            // IO error
            logger.error("Failed to reach Facebook Graph API", rae);
            throw new APIException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to reach Facebook Graph API");
        }
    }

    protected TokenDTO getTokenFromGoogle(TokenRequestDTO tokenRequest) {

        GoogleTokenVerifier googleTokenVerifier = new GoogleTokenVerifier();

        logger.debug("getTokenFromGoogle: {}", tokenRequest.getProviderAccessToken());
        try {
            GoogleIdToken.Payload payload = googleTokenVerifier.verify(tokenRequest.getProviderAccessToken());
            ProviderUserInfoDTO userInfo = new ProviderUserInfoDTO();

            // Print user identifier

            String userId = payload.getSubject(); //YOLO
            String name = (String) payload.get("name");

            userInfo.setId(userId);
            userInfo.setEmail(payload.getEmail());
            userInfo.setName(name);
            userInfo.setProvider(tokenRequest.getTokenProvider());
            userInfo.setPictureUrl((String) payload.get("picture"));
            userInfo.setLocale((String) payload.get("locale"));

            boolean emailVerified = Boolean.valueOf(payload.getEmailVerified());
            String familyName = (String) payload.get("family_name");
            String givenName = (String) payload.get("given_name");

            System.out.println("User ID: " + userId);
            System.out.println("User name: " + name);
            System.out.println("User family_name: " + familyName);
            System.out.println("User email: " + payload.getEmail());

            User user = userRepository.findByExternalId(userInfo.getId());
            if (user == null) {
                createUserFromExternalProvider(userInfo);
            }else{
                updateFromExternalProvider(user,userInfo);
            }

            return new TokenDTO(createToken(userInfo),createTokenRefresh(userInfo));
        } catch (GeneralSecurityException e) {
            e.printStackTrace();
            throw new APIException(HttpStatus.INTERNAL_SERVER_ERROR, e.getMessage());
        } catch (IOException e) {
            e.printStackTrace();
            throw new APIException(HttpStatus.INTERNAL_SERVER_ERROR, e.getMessage());
        }catch (Exception e) {
            e.printStackTrace();
            throw new APIException(HttpStatus.INTERNAL_SERVER_ERROR, e.getMessage());
        }
    }

    protected TokenDTO getTokenFromAppleSignIn(TokenRequestDTO tokenRequest) {

        String username = tokenRequest.getUsername();
        if(tokenRequest.getUsername() == null){
            throw new APIException(HttpStatus.BAD_REQUEST, "User name required for Signing in with Apple");
        }else if(userRepository.findByUserName(username) != null){
            throw new APIException(HttpStatus.BAD_REQUEST, "Bad Request");
        }

        AppleTokenVerifier appleTokenVerifier = new AppleTokenVerifier();
        ProviderUserInfoDTO userInfo = null;
        try{
            userInfo = appleTokenVerifier.verify(tokenRequest.getProviderAccessToken());
        }catch(JWTVerificationException e){
            throw new APIException(HttpStatus.UNAUTHORIZED, "Invalid token");
        }
        userInfo.setProvider(tokenRequest.getTokenProvider());
        userInfo.setName(tokenRequest.getUsername());

        User user = userRepository.findByExternalId(userInfo.getId());
        if (user == null) {
            createUserFromExternalProvider(userInfo);
        }else{
            updateFromExternalProvider(user, userInfo);
        }
        return new TokenDTO(createToken(userInfo),createTokenRefresh(userInfo));
    }

    public TokenDTO refreshToken(TokenDTO tokenRefresh){

        try {
            DecodedJWT jwt = jwtVerifier.verify(tokenRefresh.getRefreshToken());

            Claim uid = jwt.getClaim("uid");
            Claim name = jwt.getClaim("name");
            Claim email = jwt.getClaim("email");
            Claim roles = jwt.getClaim("scopes");

            logger.debug("JWToken refresh verified for uid: {}", uid.asString());

            if(roles.asString().equals("REFRESH_TOKEN")){
                ProviderUserInfoDTO userInfo = new ProviderUserInfoDTO(uid.asString(), name.asString(), email.asString());
                return createTokenPair(userInfo);
            }else{
                throw new APIException(HttpStatus.UNAUTHORIZED, "trying to refresh a token which is not a refresh token");
            }
        } catch (JWTVerificationException ve) {
            logger.warn("JWToken refresh verification failed: {}", ve.getMessage());
            throw new APIException(HttpStatus.UNAUTHORIZED, ve.getMessage());
        }
    }

    private TokenDTO createTokenPair(ProviderUserInfoDTO userInfo) {
        // check if user exists and create a new user if needed

        String accessToken = createToken(userInfo);
        String refreshToken = createTokenRefresh(userInfo);

        return new TokenDTO(accessToken,refreshToken);
    }

    private String createToken(ProviderUserInfoDTO userInfo) {
        // check if user exists and create a new user if needed
        
        Date now = new Date();

        System.out.println(jwtProperties.getTokenExpirationMinutes());
        System.out.println(tokenExpirationMillis);
        System.out.println(new Date(now.getTime() + tokenExpirationMillis));

        String jwt = JWT.create()
            .withIssuer(jwtProperties.getIss())
            .withIssuedAt(now)
            .withExpiresAt(new Date(now.getTime() + tokenExpirationMillis))
            .withClaim("uid", userInfo.getId())
            .withClaim("name", userInfo.getName())
            .withClaim("email", userInfo.getEmail())
            .sign(algorithm);

        return jwt;
    }

    private String createTokenRefresh(ProviderUserInfoDTO userInfo) {

        Date now = new Date();

        System.out.println(jwtProperties.getTokenRefreshExpirationMinutes());
        System.out.println(tokenRefreshExpirationMillis);
        System.out.println(new Date(now.getTime() + tokenRefreshExpirationMillis));

        String jwt = JWT.create()
                .withIssuer(jwtProperties.getIss())
                .withIssuedAt(now)
                .withExpiresAt(new Date(now.getTime() + tokenRefreshExpirationMillis))
                .withClaim("uid", userInfo.getId())
                .withClaim("scopes","REFRESH_TOKEN")
                .withClaim("name", userInfo.getName())
                .withClaim("email", userInfo.getEmail())
                .sign(algorithm);

        logger.debug("Refresh Token Created: " + jwt);

        return jwt;
    }

    private String normalizeUsername(ProviderUserInfoDTO userInfo){
        String username = userInfo.getName().toLowerCase().replace(' ', '-');
        username = Normalizer.normalize(username, Normalizer.Form.NFD);
        username = username.replaceAll("[\\p{InCombiningDiacriticalMarks}]", "");

        User check = userRepository.findByUserName(username);
        int suffix = 1;
        int max = 999;
        while(check != null && suffix < max + 1){
            check = userRepository.findByUserName(username + "-" + suffix);
            if(check == null){
                username = username + '-' + suffix;
            }
        }
        return username;
    }

    private User createUserFromExternalProvider(ProviderUserInfoDTO userInfo){

        String username = userInfo.getUsername();

        if(username == null){
            username = normalizeUsername(userInfo);
        }

        User user = new User(username, userInfo.getId());
        int indexOfLastSpace = userInfo.getName().lastIndexOf(" ");
        if (indexOfLastSpace > 0) {
            user.setLastName(userInfo.getName().substring(indexOfLastSpace + 1));
            user.setFirstName(userInfo.getName().substring(0, indexOfLastSpace));
        } else {
            user.setFirstName(userInfo.getName());
        }

        user.setEmail(userInfo.getEmail());
        user.setExternalIdProvider(userInfo.getProvider());
        user.setProfilePictureUrl(userInfo.getPictureUrl());
        user.setLocale(userInfo.getLocale());

        return userRepository.save(user);
    }

    private User updateFromExternalProvider(User user, ProviderUserInfoDTO userInfo) {

        int indexOfLastSpace = userInfo.getName().lastIndexOf(" ");
        if (indexOfLastSpace > 0) {
            user.setLastName(userInfo.getName().substring(indexOfLastSpace + 1));
            user.setFirstName(userInfo.getName().substring(0, indexOfLastSpace));
        } else {
            user.setFirstName(userInfo.getName());
        }

        user.setEmail(userInfo.getEmail());
        user.setExternalIdProvider(userInfo.getProvider());
        user.setExternalId(userInfo.getId());
        user.setProfilePictureUrl(userInfo.getPictureUrl());
        user.setLocale(userInfo.getLocale());

        return userRepository.save(user);
    }
}
