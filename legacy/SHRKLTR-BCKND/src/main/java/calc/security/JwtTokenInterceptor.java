package calc.security;

import calc.DTO.ProviderUserInfoDTO;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.Claim;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.lang.reflect.Method;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.ModelAndView;

/**
 * HandlerInterceptor responsible for verifying the JWTokens for secured API endpoints.
 * 
 * <p>Use the {@link Secured} annotation at the class level or method level in the controllers
 * that contain the API endpoints that should be secured.</p>
 * 
 * <p>The JWToken should be included in the 'Authorization' header using the 'Bearer' type.
 * <li>i.e. {@literal Authorization: Bearer <JW Token>}</li></p>
 *
 * @author danny
 */
@Component
public class JwtTokenInterceptor implements HandlerInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(JwtTokenInterceptor.class);
    
    @Autowired
    private JWTVerifier jwtVerifier;
    
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        logger.trace("JwtTokenInterceptor pre-handling request: {}", request.getRequestURI());
        
        HandlerMethod handlerMethod = (HandlerMethod)handler;
        Method method = handlerMethod.getMethod();
        
        // check if the class or method has the @Secured annotation
        if (method.getDeclaringClass().isAnnotationPresent(Secured.class) || method.isAnnotationPresent(Secured.class)) {
            logger.debug("@Secured method for URI: {}", request.getRequestURI());
            String authHeader = request.getHeader("Authorization");
            
            if (authHeader != null && authHeader.startsWith("Bearer")) {
                String token = authHeader.substring(7);
                logger.trace("Authorization Bearer token: {}", token);
                
                try {
                    DecodedJWT jwt = jwtVerifier.verify(token);
                    
                    Claim uid = jwt.getClaim("uid");
                    Claim name = jwt.getClaim("name");
                    Claim email = jwt.getClaim("email");
                    
                    logger.debug("JWToken verified for uid: {}", uid.asString());
                    
                    // add the FacebookUserInfoDTO as a request attribute for easy access
                    request.setAttribute("user_info", new ProviderUserInfoDTO(uid.asString(), name.asString(), email.asString()));
                } catch (JWTVerificationException ve) {
                    logger.warn("JWToken verification failed: {}", ve.getMessage());
                    setJSONErrorResponse(response, HttpStatus.UNAUTHORIZED, ve.getMessage());
                    return false;
                }
            } else {
                setJSONErrorResponse(response, HttpStatus.UNAUTHORIZED, "Invalid 'Authorization' header");
                return false;
            }
        }
        
        return true;
    }

    @Override
    public void postHandle(HttpServletRequest request, HttpServletResponse response, Object handler, ModelAndView mav) throws Exception {
        
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception excptn) throws Exception {
        
    }
    
    private void setJSONErrorResponse(HttpServletResponse response, HttpStatus status, String errorMessage) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().append("{\"error_message\":\"");
        response.getWriter().append(errorMessage);
        response.getWriter().append("\"}");
    }
}
