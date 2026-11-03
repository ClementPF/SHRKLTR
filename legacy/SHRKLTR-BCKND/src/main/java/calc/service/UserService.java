package calc.service;

import calc.DTO.*;
import calc.entity.Stats;
import calc.entity.Tournament;
import calc.entity.User;
import calc.exception.APIException;
import calc.repository.OutcomeRepository;
import calc.repository.StatsRepository;
import calc.repository.TournamentRepository;
import calc.repository.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.modelmapper.ModelMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.text.ParseException;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

/**
 * Created by clementperez on 9/20/16.
 */
@Service
public class UserService{

    private static final Logger logger = LoggerFactory.getLogger(UserService.class);
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private StatsRepository statsRepository;
    @Autowired
    private StatsService statsService;
    @Autowired
    private OutcomeService outcomeService;
    @Autowired
    private OutcomeRepository outcomeRepository;
    @Autowired
    private TournamentRepository tournamentRepository;
    @Autowired
    private ModelMapper modelMapper;

    @Resource
    private HttpServletRequest request;
    
/*
    private List<User> userFromTournament(Tournament tournament){

    }*/

    public List<UserDTO> findAll(){
        List<User> copy = new ArrayList<>();

        for (User user : userRepository.findAll()) {
            copy.add(user);
        }
        return copy.stream()
                .map(u -> convertToDto(u)).collect(Collectors.toList());
    }

    public UserDTO findOne(Long id){
        return convertToDto(userRepository.findOne(id));
    }

    /*
        This save method is not meant for creating new user from DTO.
     */
    public UserDTO update(UserDTO user){
        User loggedIn = whoIsLoggedInEntity();

        loggedIn.setFirstName(user.getFirstName());
        loggedIn.setLastName(user.getLastName());
        loggedIn.setLocale(user.getLocale());
        loggedIn.setProfilePictureUrl(user.getPictureUrl());

        return convertToDto(userRepository.save(loggedIn));
    }

    public UserDTO whoIsLoggedIn(){
        ProviderUserInfoDTO userInfo = (ProviderUserInfoDTO) request.getAttribute("user_info");
        return findByExternalId(userInfo.getId());
    }

    private User whoIsLoggedInEntity(){
        ProviderUserInfoDTO userInfo = (ProviderUserInfoDTO) request.getAttribute("user_info");
        return userRepository.findByExternalId(userInfo.getId());
    }

    public UserDTO findByUserName(String username){
        return convertToDto(userRepository.findByUserName(username));
    }

    public UserDTO findByUserId(long id){
        return convertToDto(userRepository.findByUserId(id));
    }

    public UserDTO findByExternalId(String id){
        return convertToDto(userRepository.findByExternalId(id));
    }

    public List<UserDTO> findUsersInTournament(TournamentDTO tournament){
        List<User> p = new ArrayList<>();

        List<Stats> stats = statsRepository.findByTournament(tournamentRepository.findOne(tournament.getTournamentId()));
        for(Stats s : stats){
            p.add(s.getUser());
        }

        return p.stream()
                .map(u -> convertToDto(u)).collect(Collectors.toList());
    }

    public List<UserDTO> findUsersInTournamentNamed(String tournamentName){
        List<User> p = new ArrayList<>();
        Tournament t = tournamentRepository.findByName(tournamentName);
        List<Stats> stats = statsRepository.findByTournament(t);
        for(Stats s : stats){
            p.add(s.getUser());
        }

        return p.stream()
                .map(u -> convertToDto(u, t)).collect(Collectors.toList());
    }

    public User convertToEntity(UserDTO userDto) throws ParseException {
       // User user = modelMapper.map(userDto, User.class);

        User user = new User(userDto.getUsername());
        user.setUserId(userDto.getUserId());
        user.setFirstName(userDto.getFirstName());
        user.setLastName(userDto.getLastName());

        if (userDto.getUserId() != null) {
            User u = userRepository.findOne(userDto.getUserId());
            user.setExternalId(u.getExternalId());
            user.setExternalIdProvider(u.getExternalIdProvider());
            user.setStats(statsRepository.findByUserId(userDto.getUserId()));
            user.setOutcomes(outcomeRepository.findByUserId(userDto.getUserId()));
        }

        return user;
    }

    protected UserDTO convertToDto(User user, Tournament tournament) {
       /* UserDTO userDTO = modelMapper.map(user, UserDTO.class);
        */
        UserDTO userDTO = new UserDTO();
        userDTO.setUserId(user.getUserId());
        userDTO.setFirstName(user.getFirstName());
        userDTO.setLastName(user.getLastName());
        userDTO.setUsername(user.getUserName());
        userDTO.setPictureUrl(user.getProfilePictureUrl());
        userDTO.setLocale(user.getLocale());

        return userDTO;
    }

    public UserDTO convertToDto(User user) {
   /*     UserDTO userDTO = modelMapper.map(user, UserDTO.class);*/

        UserDTO userDTO = new UserDTO();
        userDTO.setUserId(user.getUserId());
        userDTO.setLastName(user.getLastName());
        userDTO.setFirstName(user.getFirstName());
        userDTO.setUsername(user.getUserName());
        userDTO.setPictureUrl(user.getProfilePictureUrl());
        userDTO.setLocale(user.getLocale());

        return userDTO;
    }

    public UserDTO modelMapperDTO(User user){
        UserDTO userDTO = modelMapper.map(user, UserDTO.class);
        return userDTO;
    }

    public boolean exists(String username) {
        return findByUserName(username) != null;
    }


    public ResponseEntity registerForPushNotification(PushTokenDTO token) {

        User u = whoIsLoggedInEntity();
        u.setPushId(token.getValue());

        userRepository.save(u);

        return new ResponseEntity(HttpStatus.OK);
    }

    public ResponseEntity pushNotificationForUser(String username, String title ,String message, Object obj){

        User u = userRepository.findByUserName(username);
        if(u == null || u.getPushId() == null){
            throw new APIException(UserService.class, u.getUserName() + " doesn't accept challenges or doesn't have push notifications turned on.", HttpStatus.BAD_REQUEST);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, String> map= new HashMap<>();

        map.put("to", u.getPushId());
        map.put("title", title);
        map.put("body", message);
        map.put("sound","default");

        ObjectMapper mapperObj = new ObjectMapper();

        if(obj != null){
            String jsonStr = null;
            try {
                jsonStr = mapperObj.writeValueAsString(obj);
                System.out.println(jsonStr);
            } catch (IOException e) {
                e.printStackTrace();
            }

            map.put("data",  "{" +
                    "\"title\" : \"" + title + "\"," +
                    "\"message\" : \"" + message + "\"," +
                    "\"payload\" : " + jsonStr +
                    "}");
        }else{
            map.put("data",  "{" +
                    "\"title\" : \"" + title + "\"," +
                    "\"message\" : \"" + message + "\"" +
                    "}");
        }

        HttpEntity<Map<String, String>> request = new HttpEntity<>(map, headers);
        ResponseEntity<String> response = null;

        try {
            logger.debug("Making Expo push API request");
            response = new RestTemplate().postForEntity("https://exp.host/--/api/v2/push/send", request, String.class);

            if(response.getStatusCode() == HttpStatus.OK && response.getStatusCode() == HttpStatus.BAD_REQUEST){
                logger.warn("Pushing the notification failed but request is valid: {}", response.getBody());
            }
        } catch (HttpStatusCodeException hsce) {

            logger.warn("Received bad HTTP status code from EXPO push API. Exception message: {}", hsce.getMessage());
            //throw new APIException(hsce.getStatusCode(), hsce.getCause().getMessage(), hsce);
        }

        return response;
    }

    public void pushAll(String title, String message) {

        if(whoIsLoggedIn().getUserId() != 1){
            throw new APIException(UserService.class,"",HttpStatus.UNAUTHORIZED);
        }


        StreamSupport.stream(userRepository.findAll().spliterator(), false)
                .filter(u -> u.getPushId() != null)
                .forEach(user ->
                        pushNotificationForUser(user.getUserName(), title, message, null)
        );
    }
}
